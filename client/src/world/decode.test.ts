import { expect, test } from 'vitest';

import type { IssueReport, MechanicData, OwnedRaw } from '../mechanics/contract.ts';
import { MECHANIC_DATA } from '../mechanics/data/index.ts';
import { PUZZLE_TYPES } from '../puzzles/rules/index.ts';
import type { PuzzleTypeData } from '../puzzles/rules/index.ts';
import type { ChapterId, LineId, PuzzleLocalId, SectionId } from '../story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, finalTarget, toPublic, toServer } from './decode.ts';
import type { WorldIssue } from './decode.ts';
import type { Hotspot, RoomId, WorldSource } from './types.ts';

// The demo world of docs/PUZZLES-PLAN.md ("World data", "Demo content outline"), written out as the source format.
const t = (id: string, ru: string) => ({ id, ru });
const NONE: never[] = [];

function manorSource(): Record<string, unknown> {
  const gateLock = {
    slots: [{ accepts: 'medal_sun' }, { accepts: 'medal_moon' }, { accepts: 'medal_star' }],
    puzzle: 'gate',
    locked: t('ch1.manor.l0ck', 'Три углубления.'),
    onOpen: [],
    onFail: [{ story: 'manor_gate_forced' }, { unlock: 'hall.gate' }],
  };
  return {
    format: 1,
    items: {
      medal_sun: { name: t('ch1.medal_sun.n4me', 'Солнечный медальон'), desc: t('ch1.medal_sun.d3sc', 'Тёплый.'), glyph: 'sun' },
      medal_moon: { name: t('ch1.medal_moon.n4me', 'Лунный медальон'), desc: t('ch1.medal_moon.d3sc', 'Холодный.'), glyph: 'moon' },
      medal_star: { name: t('ch1.medal_star.n4me', 'Звёздный медальон'), desc: t('ch1.medal_star.d3sc', 'Тяжёлый.'), glyph: 'star' },
    },
    docs: {
      diary: { title: t('ch1.diary.t1tl', 'Дневник'), body: [t('ch1.diary.p001', '…год, когда построили дом: 1847…')] },
      letter: { title: t('ch1.letter.t1tl', 'Письмо'), body: [t('ch1.letter.p001', 'Луна раньше солнца.')] },
    },
    puzzles: {
      drawer: {
        type: 'code',
        title: t('ch1.drawer.t1tl', 'Ящик стола'),
        prompt: t('ch1.drawer.p1rm', 'Четыре латунных диска.'),
        closeup: 'drawer',
        params: { dials: 4 },
        maxAttempts: null,
        giveUp: false,
        solution: [1, 8, 4, 7],
        hints: [t('ch1.drawer.h1aa', 'Год в документе.'), t('ch1.drawer.h2bb', 'Дневник из подвала.'), t('ch1.drawer.h3cc', 'Код: 1-8-4-7.')],
      },
      gate: {
        type: 'order',
        title: t('ch1.gate.t1tl', 'Ворота'),
        prompt: t('ch1.gate.p1rm', 'Три медальона.'),
        closeup: null,
        params: { pieces: ['medal_sun', 'medal_moon', 'medal_star'] },
        maxAttempts: 3,
        giveUp: false,
        solution: [1, 0, 2],
        hints: [t('ch1.gate.h1aa', 'Надпись.'), t('ch1.gate.h2bb', 'Луна первой.'), t('ch1.gate.h3cc', 'Луна, солнце, звезда.')],
      },
    },
    sections: {
      manor: {
        start: 'hall',
        bgm: 'tension',
        rooms: {
          hall: {
            bg: 'hall',
            title: t('ch1.manor.h4ll', 'Холл'),
            onEnter: [],
            hotspots: [
              { id: 'to_study', kind: 'exit', rect: [80, 900, 220, 520], label: t('ch1.manor.ts01', 'Кабинет'), to: { room: 'study' }, lock: null, sfx: 'door' },
              { id: 'to_cellar', kind: 'exit', rect: [800, 900, 200, 520], label: t('ch1.manor.tc01', 'Подвал'), to: { room: 'cellar' }, lock: null, sfx: null },
              { id: 'gate', kind: 'exit', rect: [380, 700, 320, 700], label: t('ch1.manor.g4te', 'Ворота'), to: { story: 'manor_out' }, lock: gateLock, sfx: 'door' },
              { id: 'inscription', kind: 'look', rect: [400, 400, 280, 200], label: t('ch1.manor.in01', 'Надпись'), look: t('ch1.manor.in02', 'Луна раньше солнца, звезда последней.'), then: [] },
            ],
          },
          study: {
            bg: 'study',
            title: t('ch1.manor.st01', 'Кабинет'),
            onEnter: [],
            hotspots: [
              { id: 'medal', kind: 'take', rect: [300, 1200, 160, 160], label: t('ch1.manor.md01', 'Медальон'), gives: { item: 'medal_sun' }, prop: 'medal_sun', then: [] },
              {
                id: 'drawer',
                kind: 'object',
                rect: [500, 1300, 300, 200],
                label: t('ch1.manor.dr01', 'Ящик'),
                lock: { slots: [], puzzle: 'drawer', locked: t('ch1.manor.dr02', 'Заперт.'), onOpen: [], onFail: [] },
                then: [{ give: 'medal_moon' }],
                look: null,
                prop: null,
              },
              { id: 'letter', kind: 'take', rect: [700, 1200, 160, 160], label: t('ch1.manor.lt01', 'Письмо'), gives: { doc: 'letter' }, prop: 'note', then: [] },
              { id: 'to_hall', kind: 'exit', rect: [80, 900, 220, 520], label: t('ch1.manor.sh01', 'Холл'), to: { room: 'hall' }, lock: null, sfx: 'door' },
            ],
          },
          cellar: {
            bg: 'cellar',
            title: t('ch1.manor.ce01', 'Подвал'),
            onEnter: [{ story: 'manor_cellar_voice' }],
            hotspots: [
              { id: 'star', kind: 'take', rect: [300, 1200, 160, 160], label: t('ch1.manor.sr01', 'Медальон'), gives: { item: 'medal_star' }, prop: 'medal_star', then: [] },
              { id: 'diary', kind: 'take', rect: [600, 1200, 160, 160], label: t('ch1.manor.di01', 'Дневник'), gives: { doc: 'diary' }, prop: null, then: [] },
              { id: 'to_hall', kind: 'exit', rect: [80, 900, 220, 520], label: t('ch1.manor.ch01', 'Холл'), to: { room: 'hall' }, lock: null, sfx: null },
            ],
          },
        },
      },
    },
  };
}

/** Walks a dotted path through a fixture (test data only). */
function node(root: unknown, path: string): Record<string, unknown> {
  let at: unknown = root;
  for (const key of path.split('.')) {
    if (typeof at !== 'object' || at === null) {
      throw new Error(`fixture path ${path} breaks at ${key}`);
    }
    at = (at as Record<string, unknown>)[key]; // fixture objects and arrays, indexed by key
  }
  if (typeof at !== 'object' || at === null) {
    throw new Error(`fixture path ${path} is not an object`);
  }
  return at as Record<string, unknown>; // checked to be an object above
}

function decoded(raw: unknown = manorSource()): WorldSource {
  const r = decodeWorldSource(raw);
  if (!r.ok) {
    throw new Error(`invariant: the fixture decodes: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

function publicRaw(): Record<string, unknown> {
  return { ...structuredClone(toPublic(decoded())), version: '0123456789abcdef' };
}

function issues(r: { ok: true } | { ok: false; error: WorldIssue[] }): string[] {
  return r.ok ? [] : r.error.map((i) => `${i.path} ${i.reason}`).sort();
}

const pid = (id: string) => id as PuzzleLocalId; // fixture ids, as decoded

function hotspotOf(w: WorldSource, room: string, id: string): Hotspot | undefined {
  return w.sections['manor' as SectionId]?.rooms[room as RoomId]?.hotspots.find((h) => h.id === id); // fixture ids
}

test('decode: every schema issue reported', () => {
  expect(decodeWorldSource(manorSource()).ok).toBe(true);
  const raw = manorSource();
  node(raw, 'sections.manor.rooms.hall')['bogus'] = 1;
  delete node(raw, 'sections.manor')['start'];
  node(raw, 'sections.manor.rooms.hall.hotspots.2')['id'] = 'Gate';
  node(raw, 'puzzles.gate')['maxAttempts'] = '3';
  const r = decodeWorldSource(raw);
  expect(r.ok).toBe(false);
  expect(r.ok ? 0 : r.error.length).toBe(4);
  expect(issues(r)).toEqual(
    [
      'sections.manor.rooms.hall.bogus shape',
      'sections.manor.start shape',
      'sections.manor.rooms.hall.hotspots.2.id id',
      'puzzles.gate.maxAttempts shape',
    ].sort(),
  );

  // The params go through the type rules (dials 2..6); one fault, one issue, wherever it sits.
  const dials = manorSource();
  node(dials, 'puzzles.drawer.params')['dials'] = 7;
  node(dials, 'items.medal_sun')['glyph'] = 'skull';
  node(dials, 'sections.manor.rooms.study.hotspots.1.then.0')['unlock'] = 'hall.gate';
  node(dials, 'sections.manor.rooms.cellar.hotspots.1.label')['id'] = 'ch1.manor.BAD';
  delete node(dials, 'sections.manor.rooms.cellar')['bg'];
  expect(issues(decodeWorldSource(dials))).toEqual(
    [
      'puzzles.drawer.params shape',
      'items.medal_sun.glyph shape',
      'sections.manor.rooms.study.hotspots.1.then.0 shape',
      'sections.manor.rooms.cellar.hotspots.1.label.id line-id',
      'sections.manor.rooms.cellar.bg shape',
    ].sort(),
  );

  const hints = manorSource();
  const drawer = node(hints, 'puzzles.drawer');
  drawer['hints'] = [...(drawer['hints'] as unknown[]), t('ch1.drawer.h4dd', 'Четвёртая.')]; // the fixture's hint list
  delete node(hints, 'puzzles.gate.hints.0')['id'];
  node(hints, 'sections.manor.rooms.study.hotspots.3')['id'] = 'letter';
  expect(issues(decodeWorldSource(hints))).toEqual(
    ['puzzles.drawer.hints hint-count', 'puzzles.gate.hints.0.id hint-count', 'sections.manor.rooms.study.hotspots.3.id id'].sort(),
  );
});

test('decode: public refuses solution and hints', () => {
  const control = decodeWorldPublic(publicRaw());
  expect(control.ok).toBe(true);
  const raw = publicRaw();
  const drawer = node(raw, 'puzzles.drawer');
  drawer['solution'] = [1, 8, 4, 7];
  drawer['hints'] = [t('ch1.drawer.h1aa', 'Год в документе.')];
  const r = decodeWorldPublic(raw);
  expect(r.ok).toBe(false);
  expect(issues(r)).toEqual(['puzzles.drawer.hints secret', 'puzzles.drawer.solution secret']);
  // A source world is not a public one, even with a version stamped on it.
  expect(decodeWorldPublic({ ...manorSource(), version: '0123456789abcdef' }).ok).toBe(false);
});

test('decode: public requires version', () => {
  const raw = publicRaw();
  delete raw['version'];
  const r = decodeWorldPublic(raw);
  expect(r.ok).toBe(false);
  expect(issues(r)).toEqual(['version shape']);
  for (const bad of ['abc', '0123456789ABCDEF', 7, null]) {
    expect(issues(decodeWorldPublic({ ...raw, version: bad })), String(bad)).toEqual(['version shape']);
  }
  const ok = decodeWorldPublic({ ...raw, version: 'fedcba9876543210' });
  expect(ok.ok && ok.value.version).toBe('fedcba9876543210');
  // The source decoder has no version key.
  expect(issues(decodeWorldSource({ ...manorSource(), version: 'fedcba9876543210' }))).toEqual(['version shape']);
});

test('decode: take then and lock onOpen default to empty', () => {
  const raw = manorSource();
  delete node(raw, 'sections.manor.rooms.study.hotspots.0')['then'];
  delete node(raw, 'sections.manor.rooms.hall.hotspots.2.lock')['onOpen'];
  const r = decodeWorldSource(raw);
  expect(issues(r)).toEqual([]);
  expect(r.ok).toBe(true);
  const w = decoded(raw);
  const medal = hotspotOf(w, 'study', 'medal');
  const gate = hotspotOf(w, 'hall', 'gate');
  expect(medal?.kind === 'take' ? medal.then : null).toEqual(NONE);
  expect(gate?.kind === 'exit' ? gate.lock?.onOpen : null).toEqual(NONE);
  // Written keys are kept; the other `then` lists stay required.
  const drawer = hotspotOf(w, 'study', 'drawer');
  expect(drawer?.kind === 'object' ? drawer.then : null).toEqual([{ give: 'medal_moon' }]);
  const look = manorSource();
  delete node(look, 'sections.manor.rooms.hall.hotspots.3')['then'];
  expect(issues(decodeWorldSource(look))).toEqual(['sections.manor.rooms.hall.hotspots.3.then shape']);
});

test("world: a source puzzle's clues decode", () => {
  const raw = manorSource();
  node(raw, 'puzzles.drawer')['clues'] = [{ doc: 'diary' }];
  node(raw, 'puzzles.gate')['clues'] = [{ examined: 'hall.inscription' }, { has: 'medal_moon' }];
  const w = decoded(raw);
  expect(w.puzzles[pid('drawer')]?.clues).toEqual([{ doc: 'diary' }]);
  expect(w.puzzles[pid('gate')]?.clues).toEqual([{ examined: 'hall.inscription' }, { has: 'medal_moon' }]);
  // The key is optional: none written, none declared.
  expect(decoded().puzzles[pid('drawer')]?.clues).toEqual(NONE);
  // Every kernel fact atom of the condition grammar (engine plan §4) is a clue.
  const atoms = [
    { held: 'medal_sun' },
    { used: 'medal_sun' },
    { has: 'medal_sun' },
    { doc: 'letter' },
    { taken: 'study.medal' },
    { examined: 'hall.inscription' },
    { open: 'hall.gate' },
    { visited: 'cellar' },
    { solved: 'gate' },
    { failed: 'gate' },
  ];
  const every = manorSource();
  node(every, 'puzzles.drawer')['clues'] = atoms;
  expect(decoded(every).puzzles[pid('drawer')]?.clues).toEqual(atoms);
  // Every issue in one pass: not a list, two keys, an unknown kind, an id out of grammar, a key without its room.
  const bad = manorSource();
  node(bad, 'puzzles.drawer')['clues'] = {};
  node(bad, 'puzzles.gate')['clues'] = [{ doc: 'diary', has: 'x' }, { flag: 'f' }, { doc: 'Diary' }, { open: 'drawer' }];
  expect(issues(decodeWorldSource(bad))).toEqual(
    ['puzzles.drawer.clues shape', 'puzzles.gate.clues.0 shape', 'puzzles.gate.clues.1 shape', 'puzzles.gate.clues.2.doc id', 'puzzles.gate.clues.3.open id'].sort(),
  );
  // A public world never carries them.
  const pub = publicRaw();
  node(pub, 'puzzles.drawer')['clues'] = [{ doc: 'diary' }];
  expect(issues(decodeWorldPublic(pub))).toEqual(['puzzles.drawer.clues shape']);
});

test("decode: a world's renamed map decodes in the source and the public world", () => {
  // Every kind of engine plan §5.1, a hotspot key, a chain: the source keeps the map as written.
  const map = {
    items: { medal_old: 'medal_mid', medal_mid: 'medal_sun' },
    docs: { note: 'letter' },
    rooms: { attic: 'hall' },
    sections: { house: 'manor' },
    hotspots: { 'hall.old_gate': 'hall.gate' },
    flags: { fl_a: 'fl_b' },
    puzzles: { old_drawer: 'drawer' },
  };
  const raw = { ...manorSource(), renamed: map };
  expect(issues(decodeWorldSource(raw))).toEqual([]);
  expect(decoded(raw).renamed).toEqual(map);
  // A public world carries one as well (the build's resolved map).
  const pub = decodeWorldPublic({ ...publicRaw(), renamed: map });
  expect(pub.ok && pub.value.renamed).toEqual(map);
  // Absent stays absent: no key in either decoded value.
  expect(Object.hasOwn(decoded(), 'renamed')).toBe(false);
  const bare = decodeWorldPublic(publicRaw());
  expect(bare.ok && Object.hasOwn(bare.value, 'renamed')).toBe(false);
  // Every issue in one pass: an unknown kind, a key out of its grammar, an id where a hotspot key belongs, a non-string.
  const bad = { ...manorSource(), renamed: { bogus: {}, items: { Bad: 'x' }, hotspots: { hall: 'hall.gate' }, rooms: { a: 7 } } };
  expect(issues(decodeWorldSource(bad))).toEqual(['renamed.bogus shape', 'renamed.hotspots.hall id', 'renamed.items.Bad id', 'renamed.rooms.a id']);
  expect(issues(decodeWorldSource({ ...manorSource(), renamed: [] }))).toEqual(['renamed shape']);
  expect(issues(decodeWorldPublic({ ...publicRaw(), renamed: { hotspots: { 'hall.gate': 'gate' } } }))).toEqual(['renamed.hotspots.hall.gate id']);
});

test('finalTarget: a map is read by own keys only', () => {
  // `constructor` and `toString` are ids the grammar allows, and a decoded map is a plain object: a chain may end at
  // a prototype-named id, and a prototype-named id with no entry of its own is no rename.
  const map: Readonly<Record<string, string>> = { a_old: 'b_old', b_old: 'constructor' };
  expect(finalTarget(map, 'a_old')).toBe('constructor');
  expect(finalTarget(map, 'toString')).toBe('toString');
});

test('toPublic: strips solution and hints, keeps tier count', () => {
  const raw = manorSource();
  node(raw, 'puzzles.gate')['hints'] = [t('ch1.gate.h1aa', 'Надпись.'), t('ch1.gate.h2bb', 'Луна первой.')];
  const pub = toPublic(decoded(raw));
  const drawer = pub.puzzles[pid('drawer')];
  expect(Object.keys(drawer ?? {})).not.toContain('solution');
  expect(Object.keys(drawer ?? {})).not.toContain('hints');
  expect(Object.keys(drawer ?? {})).toEqual(['type', 'title', 'prompt', 'closeup', 'params', 'maxAttempts', 'giveUp', 'hintTiers']);
  expect(drawer?.hintTiers).toBe(3);
  expect(pub.puzzles[pid('gate')]?.hintTiers).toBe(2);
  expect(Object.keys(pub)).not.toContain('version');
  const text = JSON.stringify(pub);
  expect(text).not.toContain('"solution"');
  expect(text).not.toContain('"hints"');
  expect(text).not.toContain('ch1.drawer.h1aa');
  const back = decodeWorldPublic({ ...structuredClone(pub), version: '0123456789abcdef' });
  expect(back).toEqual({ ok: true, value: { ...pub, version: '0123456789abcdef', mods: { core: null } } });
});

test('toServer: answer shape from the type rules', () => {
  const en = { ['ch1.drawer.t1tl' as LineId]: 'Desk drawer', ['ch1.drawer.h1aa' as LineId]: 'A year in a document.' }; // fixture ids
  const server = toServer(decoded(), en, 'ch1' as ChapterId); // the fixture's chapter
  expect(server.format).toBe(1);
  expect(server.chapterId).toBe('ch1');
  const drawer = server.puzzles[pid('drawer')];
  expect(drawer?.answerLen).toBe(4);
  expect(drawer?.answerMax).toBe(9);
  const gate = server.puzzles[pid('gate')];
  expect(gate?.answerLen).toBe(3);
  expect(gate?.answerMax).toBe(2);
  expect(drawer?.solution).toEqual([1, 8, 4, 7]);
  expect(gate?.solution).toEqual([1, 0, 2]);
  expect(drawer?.title).toEqual({ ru: 'Ящик стола', en: 'Desk drawer' });
  // A missing en entry falls back to ru (loc/missing-en reports it; the server's title check stays satisfied).
  expect(gate?.title).toEqual({ ru: 'Ворота', en: 'Ворота' });
  expect(drawer?.hints).toEqual([
    { ru: 'Год в документе.', en: 'A year in a document.' },
    { ru: 'Дневник из подвала.', en: 'Дневник из подвала.' },
    { ru: 'Код: 1-8-4-7.', en: 'Код: 1-8-4-7.' },
  ]);
});

/** A fixture commit type beside the real ones (engine plan §7.1 round 5): its params pass through, its answer is 2 x 0..5. */
const CHIME: PuzzleTypeData<string, unknown> = Object.freeze({
  type: 'chime',
  check: 'commit',
  goal: 'secret',
  presentation: 'overlay',
  wrong: 'posted',
  commit: 'control',
  decodeParams: (raw: unknown) => ({ ok: true, value: raw }) as const,
  answerShape: () => ({ len: 2, max: 5 }),
  initial: () => [0, 0],
  startShown: () => null,
});

test("toServer: a fixture type's answer shape comes from the types its world was decoded with", () => {
  // Only the chime: decode does not resolve lock refs, so the manor's locks may name puzzles the world lacks.
  const raw = manorSource();
  raw['puzzles'] = {
    chime: {
      type: 'chime',
      title: t('ch1.chime.t1tl', 'Колокольчики'),
      prompt: t('ch1.chime.p1rm', 'Два звона.'),
      closeup: null,
      params: { bells: 2 },
      maxAttempts: null,
      giveUp: false,
      solution: [1, 4],
      hints: [t('ch1.chime.h1aa', 'Слушайте.')],
    },
  };
  const types = [...PUZZLE_TYPES, CHIME];
  const r = decodeWorldSource(raw, { types });
  if (!r.ok) {
    throw new Error(`invariant: the fixture decodes with its types: ${JSON.stringify(r.error)}`);
  }
  const chapter = 'ch1' as ChapterId; // the fixture's chapter
  const server = toServer(r.value, {}, chapter, undefined, { types });
  expect(server.puzzles[pid('chime')]).toEqual({
    type: 'chime',
    answerLen: 2,
    answerMax: 5,
    solution: [1, 4],
    title: { ru: 'Колокольчики', en: 'Колокольчики' },
    hints: [{ ru: 'Слушайте.', en: 'Слушайте.' }],
  });
  // Without them the emitter knows PUZZLE_TYPES only, as production does.
  expect(() => toServer(r.value, {}, chapter)).toThrow("invariant: the story tool decodes its worlds with PUZZLE_TYPES, not 'chime'");
});

// ---------------------------------------------------------------------------------------------------------------
// The composed decoder (engine plan §3.2): owned keys reach their module as `OwnedAt`s, unowned keys stay unknown

const HALL = 'sections.manor.rooms.hall';
const GATE = `${HALL}.hotspots.2`;
const SAY = t('ch1.manor.sy01', 'Тихо.');

/**
 * A fixture data half owning one key per place: its data is the `OwnedAt`s it got, a `say` decoded through the kernel's
 * text decoder (`DecodeCtx.text`); `encode` gives them back.
 */
const PROBE: MechanicData<'probe', OwnedRaw> = {
  id: 'probe',
  rules: 'none',
  owns: { world: ['probe_w'], item: ['probe_i'], room: ['probe_r'], hotspot: ['say'], slot: ['probe_s'], effect: ['probe_e'] },
  decode: (raw, ctx) => {
    const error: WorldIssue[] = [];
    const report: IssueReport = (path, reason, detail) => {
      error.push({ path, reason, detail });
    };
    const value = raw.map((a) => (Object.hasOwn(a.raw, 'say') ? { ...a, raw: { ...a.raw, say: ctx.text(a.raw['say'], `${a.path}.say`, report) } } : a));
    return error.length === 0 ? { ok: true, value } : { ok: false, error };
  },
  encode: (d) => d,
  normalize: (_w, s) => s,
};
const PROBED = { mechanics: [...MECHANIC_DATA, PROBE] };

/** The manor with one key of the probe at each place: the effect in the middle of the gate lock's onFail. */
function probed(): Record<string, unknown> {
  const raw = manorSource();
  raw['probe_w'] = 1;
  node(raw, 'items.medal_sun')['probe_i'] = 2;
  node(raw, HALL)['probe_r'] = 3;
  node(raw, `${GATE}.lock.slots.0`)['probe_s'] = 4;
  const onFail = node(raw, `${GATE}.lock`)['onFail'] as unknown[]; // the fixture's effect list
  onFail.splice(1, 0, { probe_e: 5 });
  node(raw, `${HALL}.hotspots.3`)['say'] = SAY;
  return raw;
}

test('world: an owned key reaches its module and nothing else', () => {
  const r = decodeWorldSource(probed(), PROBED);
  expect(issues(r)).toEqual([]);
  if (!r.ok) {
    throw new Error('invariant: no issue, so the world decoded');
  }
  const w = r.value;
  const mods: Readonly<Record<string, unknown>> = w.mods;
  // In walk order: the world, the items, then per room the room, its triggers, its hotspots with their locks.
  const owned = [
    { place: 'world', id: '', path: '', raw: { probe_w: 1 } },
    { place: 'item', id: 'medal_sun', path: 'items.medal_sun', raw: { probe_i: 2 } },
    { place: 'room', id: 'hall', path: HALL, raw: { probe_r: 3 } },
    { place: 'slot', id: 'hall.gate#0', path: `${GATE}.lock.slots.0`, raw: { probe_s: 4 } },
    { place: 'effect', id: 'fail:hall.gate#1', path: `${GATE}.lock.onFail.1`, raw: { probe_e: 5 } },
    { place: 'hotspot', id: 'hall.inscription', path: `${HALL}.hotspots.3`, raw: { say: SAY } },
  ];
  expect(mods['probe']).toEqual(owned);
  expect(mods['core']).toBeNull();
  expect(Object.keys(mods)).toEqual(['core', 'probe']);
  // The kernel value is the plain manor's: no place keeps an owned key, the gate's onFail keeps its two kernel effects.
  expect(w).toEqual({ ...decoded(), mods: w.mods });
  // Emission puts every key back where it was written, after the kernel's keys, and the effect at its source index.
  const body = toPublic(w, PROBED);
  const expected = structuredClone(toPublic(decoded())) as unknown as Record<string, unknown>; // the plain public body, as JSON
  expected['probe_w'] = 1;
  node(expected, 'items.medal_sun')['probe_i'] = 2;
  node(expected, HALL)['probe_r'] = 3;
  node(expected, `${GATE}.lock.slots.0`)['probe_s'] = 4;
  (node(expected, `${GATE}.lock`)['onFail'] as unknown[]).splice(1, 0, { probe_e: 5 }); // the body's effect list
  node(expected, `${HALL}.hotspots.3`)['say'] = SAY;
  expect(JSON.stringify(body)).toBe(JSON.stringify(expected));
  // The source world is untouched, and its public decode gives the module the same data.
  expect(w).toEqual({ ...decoded(), mods: w.mods });
  const back = decodeWorldPublic({ ...structuredClone(body), version: '0123456789abcdef' }, PROBED);
  const backMods: Readonly<Record<string, unknown>> | undefined = back.ok ? back.value.mods : undefined;
  expect(backMods?.['probe']).toEqual(owned);
  // Decoded with the probe but holding none of its keys, the world emits today's body.
  const plain = decodeWorldSource(manorSource(), PROBED);
  expect(plain.ok && JSON.stringify(toPublic(plain.value, PROBED))).toBe(JSON.stringify(toPublic(decoded())));
});

/** A second key-owning data half: `say` at the room, a key name the probe owns at the hotspot. */
const ECHO: MechanicData<'echo', OwnedRaw> = {
  id: 'echo',
  rules: 'none',
  owns: { room: ['say'] },
  decode: (raw) => ({ ok: true, value: raw }),
  encode: (d) => d,
  normalize: (_w, s) => s,
};
const ECHOED = { mechanics: [...MECHANIC_DATA, PROBE, ECHO] };

test('world: two key-owning modules each get only their own keys at their own places', () => {
  const raw = probed();
  const say = t('ch1.manor.sy02', 'Шорох.');
  node(raw, HALL)['say'] = say;
  // A second probe effect beside the first: the gate lock's onFail is [kernel, probe, probe, kernel] in the source.
  (node(raw, `${GATE}.lock`)['onFail'] as unknown[]).splice(2, 0, { probe_e: 6 }); // the fixture's effect list
  const r = decodeWorldSource(raw, ECHOED);
  expect(issues(r)).toEqual([]);
  if (!r.ok) {
    throw new Error('invariant: no issue, so the world decoded');
  }
  const mods: Readonly<Record<string, unknown>> = r.value.mods;
  expect(mods['echo']).toEqual([{ place: 'room', id: 'hall', path: HALL, raw: { say } }]);
  // The probe's room value keeps only its own key; each module effect is numbered by its own source index.
  expect(mods['probe']).toEqual([
    { place: 'world', id: '', path: '', raw: { probe_w: 1 } },
    { place: 'item', id: 'medal_sun', path: 'items.medal_sun', raw: { probe_i: 2 } },
    { place: 'room', id: 'hall', path: HALL, raw: { probe_r: 3 } },
    { place: 'slot', id: 'hall.gate#0', path: `${GATE}.lock.slots.0`, raw: { probe_s: 4 } },
    { place: 'effect', id: 'fail:hall.gate#1', path: `${GATE}.lock.onFail.1`, raw: { probe_e: 5 } },
    { place: 'effect', id: 'fail:hall.gate#2', path: `${GATE}.lock.onFail.2`, raw: { probe_e: 6 } },
    { place: 'hotspot', id: 'hall.inscription', path: `${HALL}.hotspots.3`, raw: { say: SAY } },
  ]);
  expect(Object.keys(mods)).toEqual(['core', 'probe', 'echo']);
  expect(r.value).toEqual({ ...decoded(), mods: r.value.mods });
  // Both modules' room keys follow the kernel's in registry order; both effects land at their source indices.
  const body = toPublic(r.value, ECHOED);
  const expected = structuredClone(toPublic(decoded())) as unknown as Record<string, unknown>; // the plain public body, as JSON
  expected['probe_w'] = 1;
  node(expected, 'items.medal_sun')['probe_i'] = 2;
  node(expected, HALL)['probe_r'] = 3;
  node(expected, HALL)['say'] = say;
  node(expected, `${GATE}.lock.slots.0`)['probe_s'] = 4;
  (node(expected, `${GATE}.lock`)['onFail'] as unknown[]).splice(1, 0, { probe_e: 5 }, { probe_e: 6 }); // the body's effect list
  node(expected, `${HALL}.hotspots.3`)['say'] = SAY;
  expect(JSON.stringify(body)).toBe(JSON.stringify(expected));
  const back = decodeWorldPublic({ ...structuredClone(body), version: '0123456789abcdef' }, ECHOED);
  expect(back.ok && back.value.mods).toEqual(mods);
});

/** A second effect-owning data half, registered after the probe: its effect is written before the probe's below. */
const ECHOFX: MechanicData<'echofx', OwnedRaw> = {
  id: 'echofx',
  rules: 'none',
  owns: { effect: ['echo_e'] },
  decode: (raw) => ({ ok: true, value: raw }),
  encode: (d) => d,
  normalize: (_w, s) => s,
};
const FXED = { mechanics: [...MECHANIC_DATA, PROBE, ECHOFX] };

test('world: effects of two modules interleaved in one list are emitted in source order whatever the registry order', () => {
  const raw = manorSource();
  // The later-registered module's effect first: the gate lock's onFail is [kernel, echofx, probe, kernel] in the source.
  (node(raw, `${GATE}.lock`)['onFail'] as unknown[]).splice(1, 0, { echo_e: 1 }, { probe_e: 2 }); // the fixture's effect list
  const r = decodeWorldSource(raw, FXED);
  expect(issues(r)).toEqual([]);
  if (!r.ok) {
    throw new Error('invariant: no issue, so the world decoded');
  }
  const mods: Readonly<Record<string, unknown>> = r.value.mods;
  expect(mods['echofx']).toEqual([{ place: 'effect', id: 'fail:hall.gate#1', path: `${GATE}.lock.onFail.1`, raw: { echo_e: 1 } }]);
  expect(mods['probe']).toEqual([{ place: 'effect', id: 'fail:hall.gate#2', path: `${GATE}.lock.onFail.2`, raw: { probe_e: 2 } }]);
  // Encoded in registry order (the probe's effect, then echofx's), each effect still lands at its source index.
  const body = toPublic(r.value, FXED);
  const expected = structuredClone(toPublic(decoded())) as unknown as Record<string, unknown>; // the plain public body, as JSON
  (node(expected, `${GATE}.lock`)['onFail'] as unknown[]).splice(1, 0, { echo_e: 1 }, { probe_e: 2 }); // the body's effect list
  expect(JSON.stringify(body)).toBe(JSON.stringify(expected));
  const back = decodeWorldPublic({ ...structuredClone(body), version: '0123456789abcdef' }, FXED);
  expect(back.ok && back.value.mods).toEqual(mods);
});

test('world: an unowned key is still refused', () => {
  expect(issues(decodeWorldSource(probed()))).toEqual(
    [
      'probe_w shape',
      'items.medal_sun.probe_i shape',
      `${HALL}.probe_r shape`,
      `${GATE}.lock.slots.0.probe_s shape`,
      `${GATE}.lock.onFail.1 shape`,
      `${HALL}.hotspots.3.say shape`,
    ].sort(),
  );
  // A key the probe owns at one place is an unknown key at every other.
  const raw = manorSource();
  node(raw, 'items.medal_sun')['say'] = SAY;
  node(raw, `${HALL}.hotspots.3`)['probe_i'] = 2;
  node(raw, `${HALL}.hotspots.0`)['probe_e'] = 5;
  expect(issues(decodeWorldSource(raw, PROBED))).toEqual(['items.medal_sun.say shape', `${HALL}.hotspots.3.probe_i shape`, `${HALL}.hotspots.0.probe_e shape`].sort());
});

test('world: a clue is a condition', () => {
  // Combinators nest atoms (engine plan §4); the decoded clue is the condition as written.
  const clue = { all: [{ doc: 'diary' }, { not: { open: 'hall.gate' } }, { any: [{ has: 'medal_sun' }, { visited: 'cellar' }] }] };
  const raw = manorSource();
  node(raw, 'puzzles.drawer')['clues'] = [clue, { examined: 'hall.inscription' }];
  expect(decoded(raw).puzzles[pid('drawer')]?.clues).toEqual([clue, { examined: 'hall.inscription' }]);
  // A combinator's fault is reported at its own path, every one in one pass.
  const bad = manorSource();
  node(bad, 'puzzles.drawer')['clues'] = [{ all: [] }, { not: { doc: 'Diary' } }, { any: [{ open: 'drawer' }, { flag: 'f' }] }];
  expect(issues(decodeWorldSource(bad))).toEqual(
    ['puzzles.drawer.clues.0.all shape', 'puzzles.drawer.clues.1.not.doc id', 'puzzles.drawer.clues.2.any.0.open id', 'puzzles.drawer.clues.2.any.1 shape'].sort(),
  );
});
