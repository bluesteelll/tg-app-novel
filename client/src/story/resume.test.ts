// Resume (PROTOTYPE-PLAN "Save format and resume", PUZZLES-PLAN X9 / F9): each level, the step-downs, the error floor
// and the world reconcile. Bodies are written from live runners of the same fixtures, the way GameSession writes
// them; versions are 16-hex literals (the levels compare strings). Every runner a test receives is disposed by it.
import { expect, test } from 'vitest';

import { compileChapter } from '../../scripts/story/compile.ts';
import { GLOBALS_PATH } from '../../scripts/story/lint.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import { decodeWorldPublic } from '../world/decode.ts';
import type { WorldPublic } from '../world/types.ts';
import { assetIndex, decodeAssetCatalog, decodeChapterMeta } from './catalog.ts';
import type { InkScalar, LoadedChapter, Result } from './catalog.ts';
import { resume } from './resume.ts';
import type { ResumeError, Resumed } from './resume.ts';
import { StoryRunner, liveRunners } from './runner.ts';
import type { RunnerError, RunnerStep } from './runner.ts';
import type { SaveBodyV1 } from './save-codec.ts';
import { EMPTY_SNAPSHOT } from './staging.ts';
import type { AssetIndex, ChapterId, KnotName, StagingSnapshot, StoryVersion, VarName } from './staging.ts';

// The fixtures name their ids directly; each matches its grammar.
const CH1 = 'ch1' as ChapterId;
const V1 = '1111111111111111' as StoryVersion;
const V2 = '2222222222222222' as StoryVersion;
const V3 = '3333333333333333' as StoryVersion;
const STAGE = { bg: 'cafe', cg: null, chars: [], bgm: null, props: [] } as unknown as StagingSnapshot;
const CHECKPOINT_STAGE = { bg: 'street', cg: null, chars: [], bgm: null, props: [] } as unknown as StagingSnapshot;

function literalAssets(): AssetIndex {
  const catalog = decodeAssetCatalog({ bg: { cafe: { placeholder: { hue: 18 } } }, chars: {}, cg: {}, bgm: {}, sfx: {}, prop: {}, cover: {} });
  if (!catalog.ok) {
    throw new Error(`invariant: the literal catalog decodes: ${JSON.stringify(catalog.error)}`);
  }
  return assetIndex(catalog.value);
}

const ASSETS = literalAssets();
const inkCache = new Map<string, unknown>();

/** ch1's compiled story from `main` (after the globals INCLUDE), parsed; memoized by source. */
function inkJson(main: readonly string[]): unknown {
  const source = `${['INCLUDE ../common/globals.ink', ...main].join('\n')}\n`;
  const hit = inkCache.get(source);
  if (hit !== undefined) {
    return hit;
  }
  const files = new Map([[GLOBALS_PATH, 'VAR g_x = 0\n'], ['ch1/main.ink', source]]);
  const r = compileChapter({ id: CH1, paid: false, entry: 'ch1/main.ink' }, (key) => files.get(key) ?? null);
  if (r.compiled === null) {
    throw new Error(`fixture does not compile: ${JSON.stringify(r.findings)}`);
  }
  const json: unknown = JSON.parse(r.compiled.json);
  inkCache.set(source, json);
  return json;
}

/** A loaded ch1 over `main` at `version`, whose knot index lists `knots` (the first is `firstKnot`). */
function chapter(main: readonly string[], knots: readonly string[], version: StoryVersion, o: { vars?: string[]; world?: WorldPublic } = {}): LoadedChapter {
  const meta = decodeChapterMeta({
    chapterId: 'ch1',
    storyVersion: version,
    firstKnot: knots[0],
    globals: ['g_x'],
    vars: ['g_x', ...(o.vars ?? [])],
    knots: Object.fromEntries(knots.map((k) => [k, { assets: [], next: [], ending: false }])),
    endings: {},
  });
  if (!meta.ok) {
    throw new Error(`fixture meta does not decode: ${JSON.stringify(meta.error)}`);
  }
  return { id: CH1, story: inkJson(main), meta: meta.value, assets: { chapterId: CH1, assets: {} }, en: null, world: o.world ?? null };
}

/** v1: the carry's branch, then knot k (three lines, a choice into two lines). */
const STORY_V1 = [
  '-> start',
  '=== start ===',
  '{ g_x == 1:',
  '    Carried. #id:ch1.start.m001',
  '- else:',
  '    Fresh. #id:ch1.start.m002',
  '}',
  '-> k',
  '=== k ===',
  'K one. #id:ch1.k.m003',
  'K two. #id:ch1.k.m004',
  'K three. #id:ch1.k.m005',
  '* [Pick. #id:ch1.k.m006]',
  '    Picked. #id:ch1.k.m007',
  '    Picked two. #id:ch1.k.m008',
  '    -> END',
];
/** v2 deletes a line before the cursor (the R3 probe). */
const STORY_V2 = STORY_V1.filter((line) => !line.includes('m004'));
/** v3 renames knot k. */
const STORY_V3 = STORY_V1.map((line) => line.replace('-> k', '-> k_new').replace('=== k ===', '=== k_new ==='));
const KNOTS = ['start', 'k'];

function body(fields: Partial<SaveBodyV1>): SaveBodyV1 {
  return {
    format: 1,
    chapterId: CH1,
    storyVersion: V1,
    ink: null,
    at: { lineId: null, knot: null, yield: null },
    staging: EMPTY_SNAPSHOT,
    checkpoint: null,
    chapterStart: { carry: {} },
    backlog: [],
    world: EMPTY_WORLD_STATE,
    worldVersion: null,
    ...fields,
  };
}

function ok<T>(r: Result<T, RunnerError>): T {
  if (!r.ok) {
    throw new Error(`runner error ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

function resumed(r: Result<Resumed, ResumeError>): Resumed {
  if (!r.ok) {
    throw new Error(`resume error ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** The fields a line or choice step is compared by. */
function shown(s: RunnerStep): unknown {
  switch (s.kind) {
    case 'line':
      return { kind: s.kind, lineId: s.lineId, knot: s.knot, enteredKnot: s.enteredKnot };
    case 'choices':
      return { kind: s.kind, choices: s.choices.map((c) => c.lineId), knot: s.knot, enteredKnot: s.enteredKnot };
    case 'yield':
      return { kind: s.kind, yield: s.yield, knot: s.knot, enteredKnot: s.enteredKnot };
    case 'end':
      return { kind: s.kind };
  }
}

/**
 * Plays `ch` from a fresh start through `steps` displayed steps (choosing 0 at a choice set) and writes the body
 * GameSession would write at the last one: the ink state, `at`, and the checkpoint of the last knot entry.
 */
function playAndSave(ch: LoadedChapter, steps: number, carry: Readonly<Record<VarName, InkScalar>> = {}): SaveBodyV1 {
  const r = ok(StoryRunner.create(ch, { kind: 'fresh', carry }, ASSETS));
  let checkpoint: SaveBodyV1['checkpoint'] = null;
  let last: RunnerStep | null = null;
  for (let i = 0; i < steps; i += 1) {
    if (last?.kind === 'choices') {
      ok(r.choose(0));
    }
    last = ok(r.next());
    if (last.kind !== 'end' && last.enteredKnot) {
      checkpoint = { knot: last.knot, vars: r.checkpointVars(), staging: CHECKPOINT_STAGE };
    }
  }
  if (last === null || last.kind === 'end') {
    throw new Error('invariant: the fixture walk stands at a line, a choice set or a yield');
  }
  const at = { lineId: last.kind === 'line' ? last.lineId : null, knot: last.knot, yield: last.kind === 'yield' ? last.yield : null };
  const saved = body({ storyVersion: ch.meta.storyVersion, ink: r.inkState(), at, staging: STAGE, checkpoint, chapterStart: { carry: { ...carry } } });
  r.dispose();
  return saved;
}

test('resume: exact', () => {
  const v1 = chapter(STORY_V1, KNOTS, V1);
  const before = liveRunners();
  // Saved at "K three." (a line shown, the choice set next).
  const atLine = resumed(resume(playAndSave(v1, 4), v1, ASSETS));
  expect(atLine.level).toBe('exact');
  expect(atLine.storyUpdated).toBe(false);
  expect(shown(atLine.first)).toEqual({ kind: 'line', lineId: 'ch1.k.m005', knot: 'k', enteredKnot: false });
  expect(atLine.first).toMatchObject({ ru: 'K three.', commands: [] });
  expect(atLine.staging).toBe(STAGE);
  expect(shown(ok(atLine.runner.next()))).toEqual({ kind: 'choices', choices: ['ch1.k.m006'], knot: 'k', enteredKnot: false });
  atLine.runner.dispose();
  // Saved at the choice set itself: the same ink state, told apart by `at.lineId`.
  const atChoices = resumed(resume(playAndSave(v1, 5), v1, ASSETS));
  expect(atChoices.level).toBe('exact');
  expect(shown(atChoices.first)).toEqual({ kind: 'choices', choices: ['ch1.k.m006'], knot: 'k', enteredKnot: false });
  ok(atChoices.runner.choose(0));
  expect(shown(ok(atChoices.runner.next()))).toEqual({ kind: 'line', lineId: 'ch1.k.m007', knot: 'k', enteredKnot: false });
  atChoices.runner.dispose();
  expect(liveRunners()).toBe(before);
});

test('resume: checkpoint after removed line', () => {
  const saved = playAndSave(chapter(STORY_V1, KNOTS, V1), 4); // at "K three.", checkpoint k
  const v2 = chapter(STORY_V2, KNOTS, V2);
  const r = resumed(resume(saved, v2, ASSETS));
  expect(r.level).toBe('checkpoint');
  expect(r.storyUpdated).toBe(true);
  // The knot's first line in v2, reported as the knot's entry (RULINGS 58 Q15).
  expect(shown(r.first)).toEqual({ kind: 'line', lineId: 'ch1.k.m003', knot: 'k', enteredKnot: true });
  expect(r.staging).toBe(CHECKPOINT_STAGE);
  expect(shown(ok(r.runner.next()))).toEqual({ kind: 'line', lineId: 'ch1.k.m005', knot: 'k', enteredKnot: false });
  r.runner.dispose();
});

test('resume: chapter start after knot rename', () => {
  const saved = playAndSave(chapter(STORY_V1, KNOTS, V1), 4, { g_x: 1 } as Record<VarName, InkScalar>);
  expect(saved.checkpoint?.knot).toBe('k');
  const v3 = chapter(STORY_V3, ['start', 'k_new'], V3);
  const r = resumed(resume(saved, v3, ASSETS));
  expect(r.level).toBe('chapter-start');
  expect(r.storyUpdated).toBe(true);
  expect(r.pendingStart).toBe(false);
  expect(shown(r.first)).toEqual({ kind: 'line', lineId: 'ch1.start.m001', knot: 'start', enteredKnot: true }); // the carry's branch
  expect(r.staging).toBe(EMPTY_SNAPSHOT);
  r.runner.dispose();
});

test('resume: ink error after checkpoint resume falls back to chapter start', () => {
  // A tunnel-onwards with no tunnel on the call stack (the story lint would refuse it), after a choice in the
  // checkpoint knot: the error surfaces only after the resumed knot's first step.
  const tunnel = [
    '-> start',
    '=== start ===',
    'Hello. #id:ch1.start.n001',
    '-> tun',
    '=== tun ===',
    'In. #id:ch1.tun.n002',
    '* [Go. #id:ch1.tun.n003]',
    '    ->->',
  ];
  const ch = chapter(tunnel, ['start', 'tun'], V2);
  const saved = playAndSave(chapter(tunnel, ['start', 'tun'], V1), 2); // at "In.", checkpoint tun
  const first = resumed(resume(saved, ch, ASSETS));
  expect(first.level).toBe('checkpoint');
  expect(shown(first.first)).toEqual({ kind: 'line', lineId: 'ch1.tun.n002', knot: 'tun', enteredKnot: true });
  is(ok(first.runner.next()), 'choices');
  ok(first.runner.choose(0));
  expect(first.runner.next()).toMatchObject({ ok: false, error: { kind: 'ink', message: expect.stringContaining('->->') } });
  first.runner.dispose();
  // "Return to last save" after the second ink error in this chapter: the floor.
  const second = resumed(resume(saved, ch, ASSETS, { minLevel: 'chapter-start' }));
  expect(second.level).toBe('chapter-start');
  expect(second.storyUpdated).toBe(false);
  expect(shown(second.first)).toEqual({ kind: 'line', lineId: 'ch1.start.n001', knot: 'start', enteredKnot: true });
  second.runner.dispose();
});

function is<K extends RunnerStep['kind']>(s: RunnerStep, kind: K): Extract<RunnerStep, { kind: K }> {
  expect(s.kind).toBe(kind);
  return s as Extract<RunnerStep, { kind: K }>; // the kind is checked on the line above
}

test('resume: exact at a yield re-yields', () => {
  const ch = chapter(
    ['VAR pz_x = 0', '-> start', '=== start ===', 'Text. #id:ch1.start.o001', '# puzzle: x then=after', '-> DONE', '=== after ===', 'After. #id:ch1.after.o002', '-> END'],
    ['start', 'after'],
    V1,
    { vars: ['pz_x'] },
  );
  const saved = playAndSave(ch, 2);
  expect(saved.at.yield).toEqual({ kind: 'puzzle', puzzle: 'x', then: 'after' });
  const r = resumed(resume(saved, ch, ASSETS));
  expect(r.level).toBe('exact');
  expect(r.first).toEqual({ kind: 'yield', yield: { kind: 'puzzle', puzzle: 'x', then: 'after' }, commands: [], knot: 'start', enteredKnot: false });
  expect(ok(r.runner.next())).toBe(r.first);
  ok(r.runner.enter('after' as KnotName, { pz_x: 1 } as Record<VarName, InkScalar>));
  expect(shown(ok(r.runner.next()))).toEqual({ kind: 'line', lineId: 'ch1.after.o002', knot: 'after', enteredKnot: true });
  r.runner.dispose();
});

test('resume: pending chapter start uses the carry', () => {
  const v1 = chapter(STORY_V1, KNOTS, V1);
  // Written at the previous chapter's end, before this chapter was bought; a global a story update removed is not
  // written (it would be an undeclared VAR).
  const saved = body({ chapterStart: { carry: { g_x: 1, g_gone: 5 } as Record<VarName, InkScalar> }, checkpoint: null });
  const r = resumed(resume(saved, v1, ASSETS));
  expect(r.level).toBe('chapter-start');
  expect(r.pendingStart).toBe(true);
  expect(r.storyUpdated).toBe(false);
  expect(shown(r.first)).toEqual({ kind: 'line', lineId: 'ch1.start.m001', knot: 'start', enteredKnot: true });
  expect(r.staging).toBe(EMPTY_SNAPSHOT);
  expect(r.world).toBe(EMPTY_WORLD_STATE);
  r.runner.dispose();
});

/** A one-section public world: a box whose lock takes a key no hotspot gives. */
function yardWorld(version: string): WorldPublic {
  const text = (n: number) => ({ id: `ch1.yard.${n.toString().padStart(4, '0')}`, ru: 'Текст.' });
  const raw = {
    format: 1,
    items: { key: { name: text(1), desc: text(2), glyph: 'key' } },
    docs: {},
    puzzles: {},
    sections: {
      yard: {
        start: 'gate',
        bgm: null,
        rooms: {
          gate: {
            bg: 'cafe',
            title: text(3),
            onEnter: [],
            hotspots: [
              {
                id: 'box',
                kind: 'object',
                rect: [100, 200, 200, 200],
                label: text(4),
                lock: { slots: [{ accepts: 'key' }], puzzle: null, locked: text(5), onOpen: [], onFail: [] },
                then: [],
                look: null,
                prop: null,
              },
            ],
          },
        },
      },
    },
    version,
  };
  const w = decodeWorldPublic(raw);
  if (!w.ok) {
    throw new Error(`invariant: the fixture world decodes: ${JSON.stringify(w.error)}`);
  }
  return w.value;
}

test('resume: every level reconciles the world', () => {
  const W_SAVED = '0000000000000000';
  const W_NOW = 'aaaaaaaaaaaaaaaa';
  const world = yardWorld(W_NOW);
  // The box is open, which the current world cannot produce from the section's entry: no hotspot gives the key.
  const unprovable = {
    ...EMPTY_WORLD_STATE,
    section: 'yard',
    room: 'gate',
    lastRoom: { yard: 'gate' },
    visited: ['gate'],
    open: ['gate.box'],
  } as unknown as WorldState;
  const v1 = chapter(STORY_V1, KNOTS, V1, { world });
  const saved = { ...playAndSave(v1, 4), world: unprovable, worldVersion: W_SAVED };

  const exact = resumed(resume(saved, v1, ASSETS));
  expect(exact.level).toBe('exact');
  expect(exact.reset).toBe('yard');
  exact.runner.dispose();

  const checkpoint = resumed(resume(saved, chapter(STORY_V2, KNOTS, V2, { world }), ASSETS));
  expect(checkpoint.level).toBe('checkpoint');
  expect(checkpoint.reset).toBe('yard');
  checkpoint.runner.dispose();

  const same = resumed(resume({ ...saved, worldVersion: W_NOW }, v1, ASSETS));
  expect(same.world).toBe(unprovable);
  expect(same.reset).toBeNull();
  same.runner.dispose();

  const start = resumed(resume(saved, v1, ASSETS, { minLevel: 'chapter-start' }));
  expect(start.level).toBe('chapter-start');
  expect(start.world).toBe(EMPTY_WORLD_STATE);
  expect(start.reset).toBeNull();
  start.runner.dispose();

  const none = resumed(resume(saved, chapter(STORY_V1, KNOTS, V1), ASSETS));
  expect(none.level).toBe('exact');
  expect(none.world).toBe(EMPTY_WORLD_STATE);
  expect(none.reset).toBeNull();
  none.runner.dispose();
});

test('resume: a body of another chapter is an error value', () => {
  const v1 = chapter(STORY_V1, KNOTS, V1);
  const before = liveRunners();
  expect(resume(body({ chapterId: 'ch2' as ChapterId }), v1, ASSETS)).toEqual({
    ok: false,
    error: { kind: 'wrong-chapter', body: 'ch2', chapter: 'ch1' },
  });
  expect(liveRunners()).toBe(before);
});

test('resume: a same-version exact load that fails falls back to checkpoint', () => {
  const v1 = chapter(STORY_V1, KNOTS, V1);
  const saved = playAndSave(v1, 6); // at "Picked.", inside the choice's container; checkpoint k
  expect(saved.at.lineId).toBe('ch1.k.m007');
  /** One resume that must step down to the checkpoint, leave exactly one runner live, and never throw. */
  const fallsBack = (b: SaveBodyV1, ch: LoadedChapter): void => {
    const before = liveRunners();
    const r = resumed(resume(b, ch, ASSETS));
    expect.soft(r.level).toBe('checkpoint');
    expect.soft(r.storyUpdated).toBe(true);
    expect.soft(shown(r.first)).toEqual({ kind: 'line', lineId: 'ch1.k.m003', knot: 'k', enteredKnot: true });
    expect.soft(liveRunners()).toBe(before + 1);
    r.runner.dispose();
  };
  // (2) An ink upgrade that keeps story.json, so storyVersion: the saved position's container is gone and inkjs
  // approximates it with a warning while loading.
  const noChoice = chapter(
    STORY_V1.filter((line) => !line.includes('m006')).map((line) => line.replace(/^ {4}/, '')),
    KNOTS,
    V1,
  );
  const ink = saved.ink ?? '';
  const before = liveRunners();
  expect(StoryRunner.create(noChoice, { kind: 'exact', ink, atYield: null, lineId: saved.at.lineId, knot: saved.at.knot }, ASSETS)).toMatchObject({
    ok: false,
    error: { kind: 'load', message: expect.stringContaining("exact internal story location couldn't be found") },
  });
  expect(liveRunners()).toBe(before);
  fallsBack(saved, noChoice);
  // (3) A position the save's `at` does not describe.
  fallsBack({ ...saved, at: { ...saved.at, lineId: 'ch1.k.zz99' as SaveBodyV1['at']['lineId'] } }, v1);
  // (1) An unloadable state: inkjs throws "ink save format incorrect".
  fallsBack({ ...saved, ink: '{}' }, v1);
});

test('resume: a checkpoint whose first step fails falls back to chapter start', () => {
  const saved = playAndSave(chapter(STORY_V1, KNOTS, V1), 4); // at "K three.", checkpoint k
  // The update leaves the knot's first line without its id: the checkpoint runner is created, then its first step fails.
  const v2 = chapter(STORY_V1.map((line) => line.replace('K one. #id:ch1.k.m003', 'K one.')), KNOTS, V2);
  const before = liveRunners();
  const r = resumed(resume(saved, v2, ASSETS));
  expect(r.level).toBe('chapter-start');
  expect(r.storyUpdated).toBe(true);
  expect(shown(r.first)).toEqual({ kind: 'line', lineId: 'ch1.start.m002', knot: 'start', enteredKnot: true });
  // The failed checkpoint runner is disposed before the floor is tried: only the returned runner is live.
  expect(liveRunners()).toBe(before + 1);
  r.runner.dispose();
});

test('resume: a bad tag on the first step keeps the level', () => {
  const saved = playAndSave(chapter(STORY_V1, KNOTS, V1), 4); // at "K three.", checkpoint k
  // The update puts a tag naming no asset above the knot's first line: the line stands without the command.
  const v2 = chapter(
    STORY_V1.flatMap((line) => (line === 'K one. #id:ch1.k.m003' ? ['# bg: nowhere', line] : [line])),
    KNOTS,
    V2,
  );
  const before = liveRunners();
  const r = resumed(resume(saved, v2, ASSETS));
  expect(r.level).toBe('checkpoint');
  expect(r.storyUpdated).toBe(true);
  expect(r.first).toMatchObject({ kind: 'line', lineId: 'ch1.k.m003', ru: 'K one.', commands: [], knot: 'k', enteredKnot: true });
  expect(r.staging).toBe(CHECKPOINT_STAGE);
  expect(liveRunners()).toBe(before + 1);
  r.runner.dispose();
});

test('resume: the chapter-start floor failing is an error value', () => {
  // The chapter's first line has no id: the chapter itself is broken.
  const broken = STORY_V1.map((line) => line.replace('Fresh. #id:ch1.start.m002', 'Fresh.'));
  const before = liveRunners();
  expect(resume(body({}), chapter(broken, KNOTS, V1), ASSETS)).toMatchObject({
    ok: false,
    error: { kind: 'runner', error: { kind: 'no-id' } },
  });
  expect(liveRunners()).toBe(before);
  // The same after every level above it failed too: each failed runner is disposed, none is returned.
  const saved = playAndSave(chapter(STORY_V1, KNOTS, V1), 4);
  const brokenToo = broken.map((line) => line.replace('K one. #id:ch1.k.m003', 'K one.'));
  expect(resume(saved, chapter(brokenToo, KNOTS, V2), ASSETS)).toMatchObject({
    ok: false,
    error: { kind: 'runner', error: { kind: 'no-id' } },
  });
  expect(liveRunners()).toBe(before);
});
