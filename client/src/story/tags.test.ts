import { expect, test } from 'vitest';

import catalogText from '../../../assets/catalog.json?raw';
import castText from '../../../story/cast.json?raw';
import { assetIndex, decodeAssetCatalog, decodeCast } from './catalog.ts';
import type { AssetCatalog, CatalogIssue } from './catalog.ts';
import { EMPTY_SNAPSHOT } from './staging.ts';
import type { AssetIndex, ParsedTags } from './staging.ts';
import { LINE_ID_RE, SPEAKER_RE, parseTags, splitSpeaker } from './tags.ts';

// A hand-built index of the demo ids (docs/PROTOTYPE-PLAN.md L3a). It does not go through the catalog decoder, so
// these tests stay valid when a later lane adds required fields to the catalog entries.
const CHARS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['ally', new Set(['neutral', 'smile', 'worried', 'angry'])],
  ['stranger', new Set(['neutral', 'smile', 'serious'])],
]);
const IDS = {
  bg: new Set(['room', 'street', 'cafe', 'archive']),
  cg: new Set(['letter', 'reveal']),
  bgm: new Set(['calm', 'tension', 'mystery']),
  sfx: new Set(['door', 'phone', 'steps']),
};
const DEMO: AssetIndex = {
  hasBg: (id) => IDS.bg.has(id),
  hasChar: (id) => CHARS.has(id),
  hasExpr: (char, expr) => CHARS.get(char)?.has(expr) ?? false,
  hasCg: (id) => IDS.cg.has(id),
  hasTrack: (id) => IDS.bgm.has(id),
  hasSfx: (id) => IDS.sfx.has(id),
};

function parse(...tags: string[]): ParsedTags {
  return parseTags(tags, DEMO);
}

function reasons(r: ParsedTags): string[] {
  return r.errors.map((e) => e.reason);
}

test('tags: every form from STAGING-DSL parses', () => {
  const forms: ReadonlyArray<readonly [string, unknown]> = [
    ['bg: cafe', { kind: 'bg', bg: 'cafe', t: 'crossfade', ms: 500 }],
    ['bg:cafe', { kind: 'bg', bg: 'cafe', t: 'crossfade', ms: 500 }],
    ['bg : cafe', { kind: 'bg', bg: 'cafe', t: 'crossfade', ms: 500 }],
    ['  bg:\tcafe  ', { kind: 'bg', bg: 'cafe', t: 'crossfade', ms: 500 }],
    ['bg: room t=fade ms=900', { kind: 'bg', bg: 'room', t: 'fade', ms: 900 }],
    ['bg: street ms=0 t=cut', { kind: 'bg', bg: 'street', t: 'cut', ms: 0 }],
    ['scene: cafe', { kind: 'scene', bg: 'cafe', t: 'fade', ms: 800 }],
    ['scene: archive t=cut ms=10000', { kind: 'scene', bg: 'archive', t: 'cut', ms: 10000 }],
    ['show: ally neutral', { kind: 'show', char: 'ally', expr: 'neutral', at: null, t: 'fade', ms: null }],
    ['show: ally neutral at=left', { kind: 'show', char: 'ally', expr: 'neutral', at: 'left', t: 'fade', ms: null }],
    [
      'show: stranger serious ms=400 t=cut at=right',
      { kind: 'show', char: 'stranger', expr: 'serious', at: 'right', t: 'cut', ms: 400 },
    ],
    ['show: ally smile at=center', { kind: 'show', char: 'ally', expr: 'smile', at: 'center', t: 'fade', ms: null }],
    ['hide: stranger', { kind: 'hide', char: 'stranger', t: 'fade', ms: 300 }],
    ['hide: all', { kind: 'hide', char: 'all', t: 'fade', ms: 300 }],
    ['hide: ally t=cut ms=0', { kind: 'hide', char: 'ally', t: 'cut', ms: 0 }],
    ['cg: letter', { kind: 'cg', cg: 'letter', t: 'fade', ms: 500 }],
    ['cg: off', { kind: 'cg', cg: null, t: 'fade', ms: 500 }],
    ['cg: reveal t=cut ms=250', { kind: 'cg', cg: 'reveal', t: 'cut', ms: 250 }],
    ['bgm: calm', { kind: 'bgm', track: 'calm', fadeMs: 1000, vol: 100 }],
    ['bgm: tension fade=2000 vol=80', { kind: 'bgm', track: 'tension', fadeMs: 2000, vol: 80 }],
    ['bgm: stop', { kind: 'bgm', track: null, fadeMs: 1000, vol: 100 }],
    ['bgm: stop fade=1500', { kind: 'bgm', track: null, fadeMs: 1500, vol: 100 }],
    ['bgm: mystery vol=0 fade=0', { kind: 'bgm', track: 'mystery', fadeMs: 0, vol: 0 }],
    ['sfx: door', { kind: 'sfx', sfx: 'door', vol: 100 }],
    ['sfx: phone vol=60', { kind: 'sfx', sfx: 'phone', vol: 60 }],
    ['wait: 1200', { kind: 'wait', ms: 1200 }],
    ['wait: 50', { kind: 'wait', ms: 50 }],
    ['wait: 10000', { kind: 'wait', ms: 10000 }],
  ];
  for (const [tag, command] of forms) {
    expect(parse(tag), tag).toEqual({ lineId: null, commands: [command], errors: [] });
  }
  expect(parse('id:ch1.cafe.k3x9')).toEqual({ lineId: 'ch1.cafe.k3x9', commands: [], errors: [] });
  // One line with a staging tag and its ID, in either order (§2 "Several tags").
  const line = { lineId: 'ch1.cafe.k3x9', commands: [{ kind: 'sfx', sfx: 'door', vol: 100 }], errors: [] };
  expect(parse('sfx: door', 'id:ch1.cafe.k3x9')).toEqual(line);
  expect(parse('id:ch1.cafe.k3x9', 'sfx: door')).toEqual(line);
});

test('tags: unknown kind is an error value', () => {
  for (const tag of ['fx: boom', 'speaker: ally', 'music: calm', 'wait2: 100', 'bgx', 'idd: ch1.cafe.k3x9']) {
    const r = parse(tag);
    expect(r.errors, tag).toEqual([{ tag, reason: 'unknown-kind', detail: expect.any(String) }]);
    expect(r.commands, tag).toEqual([]);
  }
});

test('tags: grammar violations are syntax errors', () => {
  const tags = [
    'BG: Cafe',
    'Bg: cafe',
    'bg: Cafe',
    'bg: cafe ms=1.5',
    'bg: cafe t = fade',
    'bg: cafe t= fade',
    '__x',
    '1bg: cafe',
    'bg: café',
    'bg; cafe',
    'bg cafe',
    'bg: cafe,',
    'show: ally smile at=Left',
    'show: ally smile AT=left',
    '#bg: cafe',
    'bg: {place}',
    'bg: cafe ms=5',
  ];
  for (const tag of tags) {
    expect(reasons(parse(tag)), tag).toEqual(['syntax']);
    expect(parse(tag).commands, tag).toEqual([]);
  }
});

test('tags: argument count and options are checked', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['bg', 'missing-arg'],
    ['bg:', 'missing-arg'],
    ['bg:   ', 'missing-arg'],
    ['wait:', 'missing-arg'],
    ['show: ally', 'missing-arg'],
    ['show: ally at=left', 'missing-arg'],
    ['bg: cafe street', 'bad-arg'],
    ['sfx: door phone', 'bad-arg'],
    ['show: ally smile left', 'bad-arg'],
    ['bg: cafe x=1', 'bad-arg'],
    ['sfx: door fade=100', 'bad-arg'],
    ['wait: 100 ms=100', 'bad-arg'],
    ['bg: cafe ms=100 ms=200', 'bad-arg'],
    ['bg: cafe ms=10001', 'bad-arg'],
    ['bgm: calm vol=101', 'bad-arg'],
    ['bgm: calm fade=10001', 'bad-arg'],
    ['sfx: door vol=101', 'bad-arg'],
    ['wait: 49', 'bad-arg'],
    ['wait: 0', 'bad-arg'],
    ['wait: 10001', 'bad-arg'],
    ['bg: cafe ms=abc', 'bad-arg'],
    ['wait: abc', 'bad-arg'],
    ['bg: cafe ms=99999999999999999999999', 'bad-arg'],
    ['scene: cafe t=crossfade', 'bad-arg'],
    ['bg: cafe t=dissolve', 'bad-arg'],
    ['show: ally smile at=top', 'bad-arg'],
    ['show: ally smile t=crossfade', 'bad-arg'],
  ];
  for (const [tag, reason] of cases) {
    const r = parse(tag);
    expect(reasons(r), tag).toEqual([reason]);
    expect(r.commands, tag).toEqual([]);
  }
  for (const tag of ['bg: cafe ms=0', 'bg: cafe ms=10000', 'bgm: calm vol=0', 'sfx: door vol=100', 'show: ally smile ms=0']) {
    expect(parse(tag).errors, tag).toEqual([]);
  }
});

test('tags: line id is extracted and validated', () => {
  expect(LINE_ID_RE.source).toBe('^ch[1-9][0-9]*\\.[a-z][a-z0-9_]*\\.[0-9a-z]{4}$');
  expect(parse('id:ch1.cafe.k3x9').lineId).toBe('ch1.cafe.k3x9');
  expect(parse('id : ch10.street_2.0a9z').lineId).toBe('ch10.street_2.0a9z');
  const bad = [
    'id:ch0.cafe.k3x9',
    'id:ch01.cafe.k3x9',
    'id:CH1.cafe.k3x9',
    'id:ch1.Cafe.k3x9',
    'id:ch1.1cafe.k3x9',
    'id:ch1.cafe.k3x',
    'id:ch1.cafe.k3x9x',
    'id:ch1.cafe.K3X9',
    'id:cafe.k3x9',
    'id:ch1.cafe.k3_9',
    'id:ch1..k3x9',
  ];
  for (const tag of bad) {
    const r = parse(tag);
    expect(reasons(r), tag).toEqual(['bad-id']);
    expect(r.lineId, tag).toBeNull();
  }
  expect(reasons(parse('id:'))).toEqual(['missing-arg']);
  expect(reasons(parse('id: ch1.cafe.k3x9 ch1.cafe.k3x8'))).toEqual(['bad-arg']);
  const two = parse('id:ch1.cafe.k3x9', 'sfx: door', 'id:ch1.cafe.k3x8');
  expect(two.lineId).toBe('ch1.cafe.k3x9');
  expect(two.errors).toEqual([{ tag: 'id:ch1.cafe.k3x8', reason: 'multiple-id', detail: expect.any(String) }]);
  expect(two.commands).toHaveLength(1);
});

test('tags: batch conflicts are error values', () => {
  const conflicting: ReadonlyArray<readonly [string, string]> = [
    ['bg: cafe', 'bg: room'],
    ['bg: cafe', 'scene: room'],
    ['scene: room', 'bg: cafe'],
    ['scene: cafe', 'scene: room'],
    ['scene: cafe', 'hide: ally'],
    ['scene: cafe', 'hide: all'],
    ['scene: cafe', 'cg: letter'],
    ['cg: off', 'scene: cafe'],
    ['show: ally smile', 'show: ally angry'],
    ['show: ally smile', 'hide: ally'],
    ['hide: ally', 'show: ally smile'],
    ['cg: letter', 'cg: off'],
    ['bgm: calm', 'bgm: stop'],
    ['wait: 100', 'wait: 200'],
    // D5: `all` names every character, so it conflicts with any show in the batch.
    ['hide: all', 'show: ally smile'],
    ['show: stranger neutral', 'hide: all'],
  ];
  for (const [first, second] of conflicting) {
    const r = parse(first, second);
    expect(r.errors, `${first} + ${second}`).toEqual([{ tag: second, reason: 'conflict', detail: expect.any(String) }]);
    expect(r.commands, `${first} + ${second}`).toHaveLength(2);
  }
  const allowed: ReadonlyArray<readonly string[]> = [
    ['scene: cafe', 'show: ally neutral at=left', 'show: stranger neutral', 'bgm: calm', 'sfx: door', 'wait: 500'],
    ['sfx: door', 'sfx: steps', 'sfx: door'],
    ['show: ally smile', 'show: stranger neutral'],
    ['hide: ally', 'hide: ally'],
    ['hide: all', 'hide: ally'],
    ['bg: cafe', 'cg: letter', 'show: ally smile', 'hide: stranger', 'bgm: stop'],
    ['hide: ally', 'show: stranger smile'],
  ];
  for (const tags of allowed) {
    expect(parse(...tags).errors, tags.join(' + ')).toEqual([]);
  }
});

test('tags: never throws on arbitrary input', () => {
  const inputs = [
    '',
    '#',
    ':',
    ' ',
    '\t',
    '\n',
    '::',
    '=',
    'bg:',
    'bg: =',
    'bg: a=',
    'показать: анна',
    'bg: кафе',
    'x'.repeat(10000),
    `bg: ${'a'.repeat(10000)}`,
    `id:${'c'.repeat(10000)}`,
    `bg: cafe ms=${'9'.repeat(400)}`,
    '\u0000',
    '\ud800',
    'show: ally smile at=left at=left',
    'constructor: x',
    '__proto__: x',
    'toString',
  ];
  for (const input of inputs) {
    expect(() => parseTags([input], DEMO), JSON.stringify(input.slice(0, 40))).not.toThrow();
  }
  expect(() => parseTags(inputs, DEMO)).not.toThrow();
});

test('tags: speaker prefix splits per the §5 grammar', () => {
  const cases: ReadonlyArray<readonly [string, string | null, string]> = [
    ['ally: You came after all.', 'ally', 'You came after all.'],
    ['voice: Is anyone there?', 'voice', 'Is anyone there?'],
    ['x_1: hi', 'x_1', 'hi'],
    ['ally: a: b', 'ally', 'a: b'],
    ['ally:  two spaces', 'ally', ' two spaces'],
    ['The rain had not stopped since noon.', null, 'The rain had not stopped since noon.'],
    ['Note: the door was open.', null, 'Note: the door was open.'],
    ['Mr ally: hi', null, 'Mr ally: hi'],
    ['ally:no space', null, 'ally:no space'],
    ['ally:', null, 'ally:'],
    ['ally: ', null, 'ally: '],
    ['1ally: hi', null, '1ally: hi'],
    ['Анна: привет', null, 'Анна: привет'],
    ['', null, ''],
  ];
  for (const [line, speaker, text] of cases) {
    expect(splitSpeaker(line), line).toEqual({ speaker, text });
  }
  expect(SPEAKER_RE.source).toBe('^([a-z][a-z0-9_]*): (.+)$');
});

// ---------------------------------------------------------------------------------------------------------------
// Catalog and cast. Positive cases read the committed files (a later lane that adds required entry fields updates
// those files and the decoder together); negative cases assert that one specific issue is present, never the
// exact list, so new required fields do not break them.

type RawCatalog = {
  bg: Record<string, unknown>;
  chars: Record<string, unknown>;
  cg: Record<string, unknown>;
  bgm: Record<string, unknown>;
  sfx: Record<string, unknown>;
  [key: string]: unknown;
};

const BOM = String.fromCharCode(0xfeff);

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

function parseJson(text: string): unknown {
  return JSON.parse(stripBom(text));
}

/** A fresh, mutable parse of the committed assets/catalog.json. */
function rawCatalog(): RawCatalog {
  return JSON.parse(stripBom(catalogText));
}

function committedCatalog(): AssetCatalog {
  const r = decodeAssetCatalog(rawCatalog());
  if (!r.ok) {
    throw new Error(`invariant: the committed catalog decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

function issues(r: { ok: true } | { ok: false; error: CatalogIssue[] }): CatalogIssue[] {
  return r.ok ? [] : r.error;
}

test('tags: unknown asset is an error value', () => {
  const unknown = [
    'bg: nowhere',
    'scene: nowhere',
    'show: nobody smile',
    'show: ally grin',
    'show: stranger worried',
    'show: voice neutral',
    'hide: nobody',
    'hide: voice',
    'cg: nothing',
    'bgm: silence',
    'sfx: bang',
    // Reserved words are valid only in their own slot.
    'bg: all',
    'scene: off',
    'cg: all',
    'cg: stop',
    'bgm: off',
    'bgm: all',
    'sfx: stop',
    'hide: off',
    'hide: stop',
    'show: all smile',
    'show: ally off',
  ];
  for (const index of [DEMO, assetIndex(committedCatalog())]) {
    for (const tag of unknown) {
      const r = parseTags([tag], index);
      expect(r.errors, tag).toEqual([{ tag, reason: 'unknown-asset', detail: expect.any(String) }]);
      expect(r.commands, tag).toEqual([]);
    }
    for (const tag of ['hide: all', 'cg: off', 'bgm: stop', 'show: stranger serious', 'bg: archive', 'sfx: steps']) {
      expect(parseTags([tag], index).errors, tag).toEqual([]);
    }
  }
});

test('tags: puzzle and explore parse', () => {
  const forms: ReadonlyArray<readonly [string, unknown]> = [
    ['puzzle: cabinet then=archive_after', { kind: 'puzzle', puzzle: 'cabinet', then: 'archive_after' }],
    ['puzzle:cabinet then=archive_after', { kind: 'puzzle', puzzle: 'cabinet', then: 'archive_after' }],
    ['puzzle : drawer_2 then=after2', { kind: 'puzzle', puzzle: 'drawer_2', then: 'after2' }],
    ['explore: manor', { kind: 'explore', section: 'manor' }],
    ['explore:manor', { kind: 'explore', section: 'manor' }],
    ['  explore:\tmanor  ', { kind: 'explore', section: 'manor' }],
  ];
  for (const [tag, command] of forms) {
    expect(parse(tag), tag).toEqual({ lineId: null, commands: [command], errors: [] });
  }
  // A staging tag line above the yield line joins the yield step's batch (§3.5).
  expect(parse('sfx: door', 'puzzle: cabinet then=after')).toEqual({
    lineId: null,
    commands: [
      { kind: 'sfx', sfx: 'door', vol: 100 },
      { kind: 'puzzle', puzzle: 'cabinet', then: 'after' },
    ],
    errors: [],
  });
});

test('tags: puzzle without then is missing-arg', () => {
  for (const tag of ['puzzle: cabinet', 'puzzle: then=after', 'puzzle:', 'puzzle', 'explore:']) {
    const r = parse(tag);
    expect(reasons(r), tag).toEqual(['missing-arg']);
    expect(r.commands, tag).toEqual([]);
  }
});

test('tags: yield ids and options are checked', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    // §2's grammar admits these tokens; the id and knot-name shape [a-z][a-z0-9_]* does not.
    ['puzzle: 1cabinet then=after', 'bad-arg'],
    ['puzzle: cabinet then=1after', 'bad-arg'],
    ['puzzle: cabinet then=_after', 'bad-arg'],
    ['puzzle: a b then=c', 'bad-arg'],
    ['puzzle: cabinet then=a then=b', 'bad-arg'],
    ['puzzle: cabinet then=after t=cut', 'bad-arg'],
    ['explore: manor hall', 'bad-arg'],
    ['explore: 9manor', 'bad-arg'],
    ['explore: manor then=after', 'bad-arg'],
    ['puzzle: Cabinet then=after', 'syntax'],
    ['puzzle: cabinet then=a.b', 'syntax'],
    ['puzzle: cabinet then = after', 'syntax'],
    ['explore: Manor', 'syntax'],
  ];
  for (const [tag, reason] of cases) {
    const r = parse(tag);
    expect(reasons(r), tag).toEqual([reason]);
    expect(r.commands, tag).toEqual([]);
  }
  // The reserved `_hints` suffix is the world lint's (`world/id-reserved`), not the parser's.
  expect(parse('puzzle: cabinet_hints then=after').errors).toEqual([]);
});

test('tags: two yields in one batch conflict', () => {
  const conflicting: ReadonlyArray<readonly [string, string]> = [
    ['puzzle: cabinet then=after', 'explore: manor'],
    ['explore: manor', 'puzzle: cabinet then=after'],
    ['puzzle: cabinet then=after', 'puzzle: drawer then=after'],
    ['explore: manor', 'explore: garden'],
  ];
  for (const [first, second] of conflicting) {
    const r = parse(first, second);
    expect(r.errors, `${first} + ${second}`).toEqual([{ tag: second, reason: 'conflict', detail: expect.any(String) }]);
    expect(r.commands, `${first} + ${second}`).toHaveLength(2);
  }
  const allowed: ReadonlyArray<readonly string[]> = [
    ['scene: archive', 'show: ally worried', 'bgm: tension', 'sfx: door', 'wait: 500', 'puzzle: cabinet then=after'],
    ['bg: cafe', 'cg: letter', 'explore: manor'],
    ['hide: all', 'explore: manor'],
  ];
  for (const tags of allowed) {
    expect(parse(...tags).errors, tags.join(' + ')).toEqual([]);
  }
});

test('staging: empty snapshot is frozen and holds no props', () => {
  // The value first: Object.isFrozen(undefined) is true, so the freeze checks alone would pass with no `props`.
  expect(EMPTY_SNAPSHOT.props).toEqual([]);
  expect(Object.isFrozen(EMPTY_SNAPSHOT)).toBe(true);
  expect(Object.isFrozen(EMPTY_SNAPSHOT.props)).toBe(true);
});

test('catalog: demo catalog and cast decode', () => {
  const catalog = committedCatalog();
  const keys = (o: object): string[] => Object.keys(o).sort();
  // Subset pins (STORIES-PLAN SQ9): the decoded keys restricted to the L3a demo ids equal those ids, so a later
  // catalog addition cannot reopen this file while a removed or renamed demo id still fails by name.
  const pinned = (o: object, ids: readonly string[]): string[] => keys(o).filter((k) => ids.includes(k));
  const L3A_BG = ['archive', 'cafe', 'room', 'street'];
  expect(pinned(catalog.bg, L3A_BG)).toEqual(L3A_BG);
  const L3A_CHARS = ['ally', 'stranger'];
  expect(pinned(catalog.chars, L3A_CHARS)).toEqual(L3A_CHARS);
  const L3A_EXPRS: Readonly<Record<string, readonly string[]>> = {
    ally: ['angry', 'neutral', 'smile', 'worried'],
    stranger: ['neutral', 'serious', 'smile'],
  };
  expect(
    Object.fromEntries(
      Object.entries(catalog.chars)
        .filter(([c]) => L3A_CHARS.includes(c))
        .map(([c, v]) => [c, pinned(v.exprs, L3A_EXPRS[c] ?? [])]),
    ),
  ).toEqual(L3A_EXPRS);
  const L3A_CG = ['letter', 'reveal'];
  expect(pinned(catalog.cg, L3A_CG)).toEqual(L3A_CG);
  const L3A_BGM = ['calm', 'mystery', 'tension'];
  expect(pinned(catalog.bgm, L3A_BGM)).toEqual(L3A_BGM);
  const L3A_SFX = ['door', 'phone', 'steps'];
  expect(pinned(catalog.sfx, L3A_SFX)).toEqual(L3A_SFX);
  expect(decodeCast(parseJson(castText), catalog)).toEqual({
    ok: true,
    value: { ally: { char: 'ally' }, stranger: { char: 'stranger' }, voice: { char: null } },
  });
});

test('catalog: malformed catalog is an error value', () => {
  const ownProto = (o: object): void => {
    // An own `__proto__` key, as JSON.parse creates it (an assignment would set the prototype instead).
    Object.defineProperty(o, '__proto__', { value: {}, enumerable: true, configurable: true, writable: true });
  };
  const cases: ReadonlyArray<readonly [string, (c: RawCatalog) => void, string]> = [
    ['reserved bg', (c) => (c.bg['all'] = {}), 'bg.all'],
    ['reserved cg', (c) => (c.cg['off'] = {}), 'cg.off'],
    ['reserved bgm', (c) => (c.bgm['stop'] = {}), 'bgm.stop'],
    ['reserved char', (c) => (c.chars['all'] = { exprs: { neutral: {} } }), 'chars.all'],
    ['reserved expr', (c) => (c.chars['ally'] = { exprs: { off: {} } }), 'chars.ally.exprs.off'],
    ['Bad key', (c) => (c.bg['Bad'] = {}), 'bg.Bad'],
    ['bad char key', (c) => (c.chars['Ally'] = { exprs: { neutral: {} } }), 'chars.Ally'],
    ['digit-first key', (c) => (c.sfx['1door'] = {}), 'sfx.1door'],
    ['unknown top-level key', (c) => (c['bgms'] = {}), 'bgms'],
    ['missing namespace', (c) => Reflect.deleteProperty(c, 'cg'), 'cg'],
    ['character without exprs', (c) => (c.chars['ghost'] = {}), 'chars.ghost.exprs'],
    ['character with no expressions', (c) => (c.chars['ghost'] = { exprs: {} }), 'chars.ghost.exprs'],
    ['unknown character key', (c) => (c.chars['ghost'] = { exprs: { neutral: {} }, size: 1 }), 'chars.ghost.size'],
    ['namespace not an object', (c) => Reflect.set(c, 'bg', []), 'bg'],
    ['entry not an object', (c) => (c.bg['cafe'] = 5), 'bg.cafe'],
    ['__proto__ key', (c) => ownProto(c.bg), 'bg.__proto__'],
  ];
  for (const [name, mutate, path] of cases) {
    const raw = rawCatalog();
    mutate(raw);
    const r = decodeAssetCatalog(raw);
    expect(r.ok, name).toBe(false);
    expect(issues(r), name).toContainEqual({ file: 'assets/catalog.json', path, detail: expect.any(String) });
  }
  for (const raw of [42, 'catalog', null, [], undefined]) {
    expect(issues(decodeAssetCatalog(raw)), String(raw)).toContainEqual({
      file: 'assets/catalog.json',
      path: '',
      detail: expect.any(String),
    });
  }
});

test('catalog: cast char must exist in the catalog', () => {
  const catalog = committedCatalog();
  // Positive control: the committed cast decodes against the committed catalog.
  expect(decodeCast(parseJson(castText), catalog).ok).toBe(true);
  const cases: ReadonlyArray<readonly [unknown, string]> = [
    [{ ghost: { char: 'ghost' } }, 'ghost.char'],
    [{ ally: { char: 'voice' } }, 'ally.char'],
    [{ ally: { char: 'constructor' } }, 'ally.char'],
    [{ ally: { char: 'archive' } }, 'ally.char'],
    [{ ally: { char: 5 } }, 'ally.char'],
    [{ ally: {} }, 'ally.char'],
    [{ ally: { char: 'ally', name: 'Ally' } }, 'ally.name'],
    [{ Ally: { char: 'ally' } }, 'Ally'],
    [{ ally: 'ally' }, 'ally'],
    [[], ''],
  ];
  for (const [raw, path] of cases) {
    const r = decodeCast(raw, catalog);
    expect(r.ok, path).toBe(false);
    expect(issues(r), JSON.stringify(raw)).toContainEqual({ file: 'story/cast.json', path, detail: expect.any(String) });
  }
});

test('catalog: lookups ignore inherited properties', () => {
  const index = assetIndex(committedCatalog());
  const tags = [
    'bg: constructor',
    'scene: constructor',
    'show: constructor smile',
    'show: ally constructor',
    'hide: constructor',
    'cg: constructor',
    'bgm: constructor',
    'sfx: constructor',
  ];
  for (const tag of tags) {
    expect(reasons(parseTags([tag], index)), tag).toEqual(['unknown-asset']);
  }
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect(index.hasBg(name), name).toBe(false);
    expect(index.hasChar(name), name).toBe(false);
    expect(index.hasExpr('ally', name), name).toBe(false);
    expect(index.hasExpr(name, 'smile'), name).toBe(false);
    expect(index.hasCg(name), name).toBe(false);
    expect(index.hasTrack(name), name).toBe(false);
    expect(index.hasSfx(name), name).toBe(false);
  }
  expect(index.hasExpr('ally', 'smile')).toBe(true);
});
