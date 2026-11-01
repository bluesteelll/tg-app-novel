// The story runner (PROTOTYPE-PLAN "story/runner.ts", PUZZLES-PLAN X1, STAGING-DSL §3.5): inline ink compiled by the
// story tool's compiler (any finding throws: a broken fixture is a bug), metas hand-written and decoded, the AssetIndex
// built from a literal catalog. Runners are disposed by each test, so `liveRunners()` deltas are exact.
import { expect, test } from 'vitest';

import { compileChapter } from '../../scripts/story/compile.ts';
import { GLOBALS_PATH } from '../../scripts/story/lint.ts';
import { assetIndex, decodeAssetCatalog, decodeChapterMeta } from './catalog.ts';
import type { InkScalar, LoadedChapter, Result } from './catalog.ts';
import { StoryRunner, liveRunners } from './runner.ts';
import type { RunnerError, RunnerStep, StartPoint } from './runner.ts';
import type { AssetIndex, ChapterId, KnotName, VarName } from './staging.ts';

const CH1 = 'ch1' as ChapterId; // the fixtures' chapter

function literalAssets(): AssetIndex {
  const catalog = decodeAssetCatalog({
    bg: { cafe: { placeholder: { hue: 18 } }, street: { placeholder: { hue: 215 } } },
    chars: { ally: { exprs: { neutral: { placeholder: { hue: 200 } }, smile: { placeholder: { hue: 160 } } } } },
    cg: { letter: { placeholder: { hue: 40 } } },
    bgm: { calm: { placeholder: { hz: 220 } } },
    sfx: { door: { placeholder: { hz: 440 } } },
    prop: {},
    cover: {},
  });
  if (!catalog.ok) {
    throw new Error(`invariant: the literal catalog decodes: ${JSON.stringify(catalog.error)}`);
  }
  return assetIndex(catalog.value);
}

const ASSETS = literalAssets();
const GLOBALS = 'VAR g_x = 0\n';
const inkCache = new Map<string, unknown>();

/** ch1's compiled story from `main` (after the globals INCLUDE), parsed; memoized by source. */
function inkJson(main: readonly string[]): unknown {
  const source = `${['INCLUDE ../common/globals.ink', ...main].join('\n')}\n`;
  const hit = inkCache.get(source);
  if (hit !== undefined) {
    return hit;
  }
  const files = new Map([[GLOBALS_PATH, GLOBALS], ['ch1/main.ink', source]]);
  const r = compileChapter({ id: CH1, paid: false, entry: 'ch1/main.ink' }, (key) => files.get(key) ?? null);
  if (r.compiled === null) {
    throw new Error(`fixture does not compile: ${JSON.stringify(r.findings)}`);
  }
  const json: unknown = JSON.parse(r.compiled.json);
  inkCache.set(source, json);
  return json;
}

/** A loaded ch1 over `main` whose knot index lists `knots` (the first is `firstKnot`) and whose VARs add `vars`. */
function chapter(main: readonly string[], knots: readonly string[], vars: readonly string[] = []): LoadedChapter {
  const meta = decodeChapterMeta({
    chapterId: 'ch1',
    storyVersion: '0123456789abcdef',
    firstKnot: knots[0],
    globals: ['g_x'],
    vars: ['g_x', ...vars],
    knots: Object.fromEntries(knots.map((k) => [k, { assets: [], next: [], ending: false }])),
    endings: {},
  });
  if (!meta.ok) {
    throw new Error(`fixture meta does not decode: ${JSON.stringify(meta.error)}`);
  }
  return { id: CH1, story: inkJson(main), meta: meta.value, assets: { chapterId: CH1, assets: {} }, en: null, world: null };
}

function runner(ch: LoadedChapter, start: StartPoint = { kind: 'fresh', carry: {} }): StoryRunner {
  const r = StoryRunner.create(ch, start, ASSETS);
  if (!r.ok) {
    throw new Error(`create failed: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** The value, or a throw naming the RunnerError, so a red says what the runner returned. */
function ok<T>(r: Result<T, RunnerError>): T {
  if (!r.ok) {
    throw new Error(`runner error ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

/** The step narrowed to `kind`; a step of another kind fails here with both kinds in the message. */
function is<K extends RunnerStep['kind']>(s: RunnerStep, kind: K): Extract<RunnerStep, { kind: K }> {
  expect(s.kind).toBe(kind);
  return s as Extract<RunnerStep, { kind: K }>; // the kind is checked on the line above
}

test('runner: tag-only steps merge into next', () => {
  const ch = chapter(
    [
      '-> start',
      '=== start ===',
      '# scene: cafe',
      'Hello. #id:ch1.start.a001',
      '# sfx: door',
      '* [Go. #id:ch1.start.a002]',
      '    After. #id:ch1.start.a003',
      '    # bgm: stop',
      '    -> END',
    ],
    ['start'],
  );
  const r = runner(ch);
  // (b) the knot-level tag runs once, with the knot's first line.
  const hello = is(ok(r.next()), 'line');
  expect(hello.ru).toBe('Hello.');
  expect(hello.commands).toEqual([{ kind: 'scene', bg: 'cafe', t: 'fade', ms: 800 }]);
  // (a) the tag line before the choice set runs with the choices, never with the line after the choice.
  const pick = is(ok(r.next()), 'choices');
  expect(pick.commands).toEqual([{ kind: 'sfx', sfx: 'door', vol: 100 }]);
  expect(pick.choices.map((c) => c.lineId)).toEqual(['ch1.start.a002']);
  ok(r.choose(0));
  const after = is(ok(r.next()), 'line');
  expect(after.ru).toBe('After.');
  expect(after.commands).toEqual([]);
  // (c) the tags before `-> END` are the end step's.
  const end = is(ok(r.next()), 'end');
  expect(end.commands).toEqual([{ kind: 'bgm', track: null, fadeMs: 1000, vol: 100 }]);
  r.dispose();
});

test('runner: speaker prefix stripped', () => {
  const ch = chapter(
    [
      '-> start',
      '=== start ===',
      'ally: Привет. #id:ch1.start.b001',
      'The street is quiet. #id:ch1.start.b002',
      '* [Say hello. #id:ch1.start.b003]',
      '    -> END',
    ],
    ['start'],
  );
  const r = runner(ch);
  const said = is(ok(r.next()), 'line');
  expect(said.ru).toBe('Привет.');
  expect(said.speaker).toBe('ally');
  expect(said.lineId).toBe('ch1.start.b001');
  const told = is(ok(r.next()), 'line');
  expect(told.ru).toBe('The street is quiet.');
  expect(told.speaker).toBeNull();
  const pick = is(ok(r.next()), 'choices');
  expect(pick.choices).toEqual([{ index: 0, lineId: 'ch1.start.b003', ru: 'Say hello.' }]);
  r.dispose();
});

test('runner: puzzle yield stops at DONE', () => {
  // STAGING-DSL §6's yield block: the line, the tag lines, `-> DONE`.
  const ch = chapter(
    [
      '-> start',
      '=== start ===',
      'Text. #id:ch1.start.c001',
      '# sfx: door',
      '# puzzle: cabinet then=after',
      '-> DONE',
      '=== after ===',
      'After. #id:ch1.after.c002',
      '-> END',
    ],
    ['start', 'after'],
  );
  const r = runner(ch);
  expect(is(ok(r.next()), 'line').ru).toBe('Text.');
  const stop = is(ok(r.next()), 'yield');
  expect(stop.yield).toEqual({ kind: 'puzzle', puzzle: 'cabinet', then: 'after' });
  expect(stop.commands).toEqual([{ kind: 'sfx', sfx: 'door', vol: 100 }]);
  expect(stop.knot).toBe('start');
  // A stray advance re-reads the yield: never an `end`, never an ink error ("ran out of content").
  expect(ok(r.next())).toBe(stop);
  expect(r.current()).toBe(stop);
  r.dispose();
});

test('runner: errors are values, never thrown', () => {
  // A `->->` with no tunnel on the call stack fails at runtime (the story lint would refuse it).
  const tunnel = runner(
    chapter(['-> start', '=== start ===', 'Hello. #id:ch1.start.d001', '-> tun', '=== tun ===', 'In. #id:ch1.tun.d002', '->->'], ['start', 'tun']),
  );
  let failed: Result<RunnerStep, RunnerError> = tunnel.next();
  for (let i = 0; i < 3 && failed.ok; i += 1) {
    failed = tunnel.next();
  }
  expect(failed).toMatchObject({ ok: false, error: { kind: 'ink', message: expect.stringContaining('->->') } });
  // Poisoned: every later call returns the same error.
  expect(tunnel.next()).toEqual(failed);
  expect(tunnel.choose(0)).toEqual(failed);
  tunnel.dispose();

  const bare = runner(chapter(['-> start', '=== start ===', 'A line without an id.', '-> END'], ['start']));
  expect(bare.next()).toMatchObject({ ok: false, error: { kind: 'no-id' } });
  expect(bare.next()).toMatchObject({ ok: false, error: { kind: 'no-id' } });
  bare.dispose();

  // A choice is shown text too: one without its line ID is the same error, never a choice with a null id.
  const bareChoice = runner(chapter(['-> start', '=== start ===', 'Pick. #id:ch1.start.d003', '* [No id here]', '    -> END'], ['start']));
  is(ok(bareChoice.next()), 'line');
  expect(bareChoice.next()).toMatchObject({ ok: false, error: { kind: 'no-id' } });
  expect(bareChoice.next()).toMatchObject({ ok: false, error: { kind: 'no-id' } });
  bareChoice.dispose();

  const tagged = runner(
    chapter(
      [
        '-> start',
        '=== start ===',
        '# bg: nowhere',
        'Look. #id:ch1.start.e001',
        'Then. #id:ch1.start.e002',
        '* [One. #id:ch1.start.e003]',
        '    -> END',
        '* [Two. #id:ch1.start.e004]',
        '    -> END',
      ],
      ['start'],
    ),
  );
  expect(tagged.next()).toMatchObject({ ok: false, error: { kind: 'tags', lineId: 'ch1.start.e001', errors: [{ reason: 'unknown-asset' }] } });
  // Not terminal: the line stands with the bad command dropped, and the story goes on.
  expect(tagged.current()).toMatchObject({ kind: 'line', lineId: 'ch1.start.e001', ru: 'Look.', commands: [] });
  expect(tagged.choose(0)).toEqual({ ok: false, error: { kind: 'bad-choice', index: 0 } });
  expect(is(ok(tagged.next()), 'line').ru).toBe('Then.');
  expect(is(ok(tagged.next()), 'choices').choices).toHaveLength(2);
  expect(tagged.choose(5)).toEqual({ ok: false, error: { kind: 'bad-choice', index: 5 } });
  ok(tagged.choose(1));
  is(ok(tagged.next()), 'end');
  tagged.dispose();
});

test('runner: dispose is idempotent and counts live runners', () => {
  const ch = chapter(['-> start', '=== start ===', 'Hello. #id:ch1.start.f001', '-> END'], ['start']);
  const before = liveRunners();
  const r = runner(ch);
  expect(liveRunners()).toBe(before + 1);
  r.dispose();
  expect(liveRunners()).toBe(before);
  r.dispose();
  expect(liveRunners()).toBe(before);
  expect(r.next().ok).toBe(false);
});

/** VAR values keyed by name: the fixtures name their VARs directly. */
function vars(values: Readonly<Record<string, InkScalar>>): Readonly<Record<VarName, InkScalar>> {
  return values as Readonly<Record<VarName, InkScalar>>;
}

/** PUZZLES-PLAN W8: a yield whose then-knot opens with a choice gated on the outcome VAR. */
function puzzleChapter(): LoadedChapter {
  return chapter(
    [
      'VAR pz_x = 0',
      '-> start',
      '=== start ===',
      'Text. #id:ch1.start.g001',
      '# puzzle: x then=after',
      '-> DONE',
      '=== after ===',
      '* {pz_x == 1} [Open it. #id:ch1.after.g002]',
      '    Opened. #id:ch1.after.g003',
      '    -> END',
      '* [Leave. #id:ch1.after.g004]',
      '    Left. #id:ch1.after.g005',
      '    -> END',
    ],
    ['start', 'after'],
    ['pz_x'],
  );
}

/** A runner of `puzzleChapter` stopped at its yield. */
function atYield(): { r: StoryRunner; stop: RunnerStep } {
  const r = runner(puzzleChapter());
  is(ok(r.next()), 'line');
  const stop = is(ok(r.next()), 'yield');
  return { r, stop };
}

test('runner: then-knot choices see the outcome', () => {
  const { r } = atYield();
  ok(r.enter('after' as KnotName, vars({ pz_x: 1 })));
  const pick = is(ok(r.next()), 'choices');
  expect(pick.choices.map((c) => c.lineId)).toEqual(['ch1.after.g002', 'ch1.after.g004']);
  r.dispose();
});

test('runner: enter rejects undeclared projection var', () => {
  const { r, stop } = atYield();
  expect(r.enter('after' as KnotName, vars({ pz_nope: 1 }))).toEqual({
    ok: false,
    error: { kind: 'bad-projection', name: 'pz_nope', detail: expect.any(String) },
  });
  expect(r.enter('after' as KnotName, vars({ pz_x: true }))).toEqual({
    ok: false,
    error: { kind: 'bad-projection', name: 'pz_x', detail: expect.any(String) },
  });
  // Nothing moved: the story still stands at its yield.
  expect(r.current()).toBe(stop);
  expect(ok(r.next())).toBe(stop);
  r.dispose();
});

test('runner: enter outside a yield is an error', () => {
  const r = runner(puzzleChapter());
  is(ok(r.next()), 'line');
  expect(r.enter('after' as KnotName, vars({ pz_x: 1 }))).toEqual({ ok: false, error: { kind: 'not-at-yield' } });
  is(ok(r.next()), 'yield');
  r.dispose();
});

test('runner: enter an unknown knot is an error', () => {
  const { r, stop } = atYield();
  expect(r.enter('nowhere' as KnotName, {})).toEqual({ ok: false, error: { kind: 'unknown-knot', knot: 'nowhere' } });
  expect(r.current()).toBe(stop);
  r.dispose();
});

/** A step as `[kind, knot, enteredKnot]`; an `end` step has neither. */
type Seen = readonly [RunnerStep['kind'], string | null, boolean | null];

function seen(s: RunnerStep): Seen {
  return s.kind === 'end' ? ['end', null, null] : [s.kind, s.knot, s.enteredKnot];
}

/** Every step up to an `end` or a yield; at the n-th choice set it takes `picks[n]`. */
function walk(r: StoryRunner, picks: readonly number[]): Seen[] {
  const out: Seen[] = [];
  let pick = 0;
  for (let n = 0; n < 20; n += 1) {
    const s = ok(r.next());
    out.push(seen(s));
    if (s.kind === 'end' || s.kind === 'yield') {
      return out;
    }
    if (s.kind === 'choices') {
      ok(r.choose(picks[pick] ?? 0));
      pick += 1;
    }
  }
  throw new Error(`the walk did not stop: ${JSON.stringify(out)}`);
}

test("runner: enteredKnot on a knot's first step", () => {
  // S1 the chapter start, S2 a divert into a two-line knot, S3 a knot opening with a tag line, S7 a line after a
  // gather, S4 a one-line ending knot entered from a choice (its line ends at `-> END`: a null pointer).
  const linear = runner(
    chapter(
      [
        '-> start',
        '=== start ===',
        'Hello. #id:ch1.start.h001',
        '-> b',
        '=== b ===',
        'B one. #id:ch1.b.h002',
        'B two. #id:ch1.b.h003',
        '-> c',
        '=== c ===',
        '# scene: cafe',
        'C one. #id:ch1.c.h004',
        'C two. #id:ch1.c.h005',
        '* [Pick. #id:ch1.c.h006]',
        '    Picked. #id:ch1.c.h007',
        '- Gathered. #id:ch1.c.h008',
        '* [End it. #id:ch1.c.h009] -> end_k',
        '=== end_k ===',
        'The end. #id:ch1.end_k.h010',
        '-> END',
      ],
      ['start', 'b', 'c', 'end_k'],
    ),
  );
  expect.soft(walk(linear, [0, 0])).toEqual([
    ['line', 'start', true], // S1
    ['line', 'b', true], // S2
    ['line', 'b', false],
    ['line', 'c', true], // S3
    ['line', 'c', false],
    ['choices', 'c', false],
    ['line', 'c', false],
    ['line', 'c', false], // S7
    ['choices', 'c', false],
    ['line', 'end_k', true], // S4
    ['end', null, null],
  ]);
  linear.dispose();

  // S5 a choices-only knot entered by a divert after another knot's two lines: the line before the divert is already
  // `pick`'s (D4's one-step-early case, the same stage). Then a hub that diverts to its own top inside ink: no entry on
  // the second pass (PROTOTYPE-PLAN's rule; RULINGS 58 Q17).
  const choicesOnly = runner(
    chapter(
      [
        '-> a',
        '=== a ===',
        'A one. #id:ch1.a.h011',
        'A two. #id:ch1.a.h012',
        '-> pick',
        '=== pick ===',
        '* [To the hub. #id:ch1.pick.h013] -> hub',
        '* [Stop. #id:ch1.pick.h014] -> END',
        '=== hub ===',
        'The hub. #id:ch1.hub.h015',
        '+ [Stay. #id:ch1.hub.h016] -> hub',
        '+ [Leave. #id:ch1.hub.h017] -> END',
      ],
      ['a', 'pick', 'hub'],
    ),
  );
  expect.soft(walk(choicesOnly, [0, 0, 1])).toEqual([
    ['line', 'a', true],
    ['line', 'pick', true], // S5
    ['choices', 'pick', false],
    ['line', 'hub', true],
    ['choices', 'hub', false],
    ['line', 'hub', false], // the hub's second pass (Q17)
    ['choices', 'hub', false],
    ['end', null, null],
  ]);
  choicesOnly.dispose();

  // S6 enter() into the yielding knot itself (a retry): a host re-entry is a knot top (Q4).
  const retry = runner(
    chapter(['-> start', '=== start ===', 'Try. #id:ch1.start.h018', '# puzzle: x then=start', '-> DONE'], ['start']),
  );
  expect.soft(walk(retry, [])).toEqual([
    ['line', 'start', true],
    ['yield', 'start', false],
  ]);
  ok(retry.enter('start' as KnotName, {}));
  expect.soft(walk(retry, [])).toEqual([
    ['line', 'start', true], // S6
    ['yield', 'start', false],
  ]);
  retry.dispose();
});

test("runner: checkpoint vars are read at the knot's entry", () => {
  // The romance shape (critique W1): a reply knot bumps a counter, says one line, then diverts into a knot that opens
  // with text. That line's lookahead enters next_scene (counter already bumped) before ink rolls it back.
  const r = runner(
    chapter(
      [
        'VAR affection = 0',
        '-> start',
        '=== start ===',
        'Hello. #id:ch1.start.i001',
        '* [Be kind. #id:ch1.start.i002] -> kind_reply',
        '=== kind_reply ===',
        '~ affection = affection + 1',
        'She smiles. #id:ch1.kind_reply.i003',
        '-> next_scene',
        '=== next_scene ===',
        'Next. #id:ch1.next_scene.i004',
        'Later. #id:ch1.next_scene.i005',
        '-> END',
      ],
      ['start', 'kind_reply', 'next_scene'],
      ['affection'],
    ),
  );
  is(ok(r.next()), 'line');
  is(ok(r.next()), 'choices');
  ok(r.choose(0));
  const reply = is(ok(r.next()), 'line');
  expect([reply.knot, reply.enteredKnot]).toEqual(['kind_reply', true]);
  expect(r.readVars(['affection' as VarName])).toEqual({ affection: 1 });
  // The value before kind_reply's top ran: a checkpoint resume replays the increment exactly once.
  expect(r.checkpointVars()).toEqual({ g_x: 0, affection: 0 });
  const next = is(ok(r.next()), 'line');
  expect([next.knot, next.enteredKnot]).toEqual(['next_scene', true]);
  expect(r.checkpointVars()).toEqual({ g_x: 0, affection: 1 });
  is(ok(r.next()), 'line'); // no entry: the checkpoint stays next_scene's
  expect(r.checkpointVars()).toEqual({ g_x: 0, affection: 1 });
  r.dispose();

  // A host entry snapshots after the projection is written: the then-knot's checkpoint holds the outcome.
  const { r: solved } = atYield();
  ok(solved.enter('after' as KnotName, vars({ pz_x: 1 })));
  expect(is(ok(solved.next()), 'choices').enteredKnot).toBe(true);
  expect(solved.checkpointVars()).toEqual({ g_x: 0, pz_x: 1 });
  solved.dispose();
});
