import { expect, test } from 'vitest';

import type { ChapterId, LineId, PuzzleLocalId, SectionId } from '../story/staging.ts';
import { decodeWorldPublic, decodeWorldSource, toPublic, toServer } from './decode.ts';
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
  expect(back).toEqual({ ok: true, value: { ...pub, version: '0123456789abcdef' } });
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
