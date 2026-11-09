// The motion gate (engine plan §8.5): every cue key has a motion a player sees, the frame's end motions fit inside its
// outro, and the data the stage and its later lanes read stays coupled.
import { expect, test } from 'vitest';

import { EMPTY_WORLD_STATE } from '../../explore/state.ts';
import type { WorldState } from '../../explore/state.ts';
import { KERNEL_FACT_KINDS, SILENT_FIELDS } from '../../mechanics/contract.ts';
import type { FactKind } from '../../mechanics/contract.ts';
import { MECHANIC_DATA } from '../../mechanics/data/index.ts';
import { MECHANIC_RULES } from '../../mechanics/rules/index.ts';
import type { PuzzleTypeData } from '../../puzzles/rules/index.ts';
import { CORE_CONTROLS, FRAME_OPEN_MS, MIN_VISIBLE_MS, MOVE_HOWS, PUZZLE_CUES, UI_STATE_CUES } from '../types.ts';
import type { ControlCue, CueKey } from '../types.ts';
import { keyframesVisible, LAYER_MOTIONS } from '../visible.ts';
import type { LayerMotion } from '../visible.ts';
import { CUE_MOTIONS, declaredControls, UI_MOTIONS, uiMotion } from './motions.ts';
import type { MotionSpec, WithMotion } from './motions.ts';
import { PRESET_SITE, PRESETS } from './presets.ts';

type Motion = Omit<MotionSpec, 'byCause' | 'with'> | WithMotion;
type Keyed = readonly [label: string, spec: Motion];

/** The fact kinds the registries own (the kernel's and every module's), from the runtime tuples. */
function factKinds(): string[] {
  const owned = MECHANIC_DATA.flatMap((m): readonly string[] => m.owns.facts ?? []);
  return [...new Set<string>([...KERNEL_FACT_KINDS, ...owned])];
}

/** Every non-control key, built from the runtime tuples (never from `CUE_MOTIONS` itself). */
function nonControlKeys(): string[] {
  return [
    ...factKinds().flatMap((k) => [`fact:${k}:added`, `fact:${k}:removed`]),
    ...MOVE_HOWS.map((h) => `move:${h}`),
    ...MECHANIC_RULES.flatMap((r) => {
      const names: readonly string[] = r.cues;
      return names.map((c) => `module:${r.id}:${c}`);
    }),
    ...UI_STATE_CUES.map((n) => `ui-state:${n}`),
    ...PUZZLE_CUES.map((n) => `puzzle:${n}`),
  ];
}

/** Every control name: the core list and every type's and module's declared controls. */
function controls(): ControlCue[] {
  // A declared name is a `ControlCue` by derivation from the same registries.
  return [...CORE_CONTROLS, ...declaredControls().map((d) => d.name as ControlCue)];
}

/** A row's first motion, each cause variant and every `with` entry, each as its own spec. */
function specsOf(label: string, spec: MotionSpec): Keyed[] {
  const variants = Object.entries(spec.byCause ?? {}).map(([cause, v]): readonly [string, MotionSpec] => [`${label}~${cause}`, v]);
  return [[label, spec] as const, ...variants].flatMap(([l, s]): Keyed[] => [
    [l, s],
    ...(s.with ?? []).map((w, i): Keyed => [`${l} with ${i}`, w]),
  ]);
}

/** Every spec of every key: the rows, the control motions through `uiMotion`, and the gesture default. */
function everySpec(): Keyed[] {
  const rows: Readonly<Record<string, MotionSpec>> = CUE_MOTIONS;
  return [
    ...nonControlKeys().flatMap((k): Keyed[] => {
      const spec = rows[k];
      return spec === undefined ? [] : specsOf(k, spec);
    }),
    ...controls().flatMap((c) => specsOf(`ui:${c}`, uiMotion(c))),
    ...specsOf('ui gesture step', UI_MOTIONS.gesture),
  ];
}

const LAYERS = Object.entries(LAYER_MOTIONS) as readonly (readonly [string, LayerMotion])[];

test('cues: every cue key has a visible motion', () => {
  const rows: Readonly<Record<string, MotionSpec>> = CUE_MOTIONS;
  // Non-vacuous: the key set is the registries', and the table holds exactly it (a key the tuples build but the table
  // lacks, or a row no tuple names, is a divergence between the runtime tuples and the types).
  const keys = nonControlKeys();
  expect(keys.length).toBeGreaterThan(60);
  expect(Object.keys(rows).sort()).toEqual([...keys].sort());
  const problems: string[] = [];
  for (const [label, spec] of everySpec()) {
    if (!(spec.ms >= MIN_VISIBLE_MS)) {
      problems.push(`${label}: ms ${spec.ms} < ${MIN_VISIBLE_MS}`);
    }
    for (const preset of [spec.preset, spec.reduced]) {
      if (!keyframesVisible(PRESETS[preset])) {
        problems.push(`${label}: preset ${preset} invisible`);
      }
    }
  }
  for (const [name, layer] of LAYERS) {
    for (const [form, m] of [['', layer], [' reduced', layer.reduced]] as const) {
      if (!(m.ms >= MIN_VISIBLE_MS)) {
        problems.push(`LAYER_MOTIONS.${name}${form}: ms ${m.ms} < ${MIN_VISIBLE_MS}`);
      }
      if (!keyframesVisible(m.keyframes)) {
        problems.push(`LAYER_MOTIONS.${name}${form}: keyframes invisible`);
      }
    }
  }
  expect(problems).toEqual([]);
  // MR1's debt, printed on every run so each build log shows it (§8.5 "No no-op default exists").
  const all = [...keys.map((k) => rows[k]), ...controls().map((c) => uiMotion(c)), UI_MOTIONS.gesture];
  const pending = all.filter((s) => s?.scene === null).length;
  console.log(`scene motions pending: ${pending} of ${all.length} keys (MR1)`);
});

/** The properties reduced motion may change (opacity and colour) and the ones it never animates (travel). */
const CALM = ['opacity', 'color', 'backgroundColor'] as const;
const TRAVEL_PROPS = ['transform', 'translate', 'scale', 'rotate', 'offsetPath', 'offsetDistance'] as const;

test('cues: reduced motion keeps every key visible', () => {
  const problems: string[] = [];
  const check = (label: string, kf: readonly Keyframe[]): void => {
    if (!CALM.some((p) => new Set(kf.map((f) => String(f[p] ?? ''))).size > 1)) {
      problems.push(`${label}: changes no opacity or colour`);
    }
    for (const p of TRAVEL_PROPS) {
      if (kf.some((f) => f[p] !== undefined)) {
        problems.push(`${label}: animates ${p}`);
      }
    }
  };
  for (const [label, spec] of everySpec()) {
    check(`${label} reduced ${spec.reduced}`, PRESETS[spec.reduced]);
  }
  for (const [name, layer] of LAYERS) {
    check(`LAYER_MOTIONS.${name} reduced`, layer.reduced.keyframes);
  }
  expect(problems).toEqual([]);
});

const END_ROWS = ['puzzle:solved', 'puzzle:failed', 'puzzle:closed'] as const satisfies readonly CueKey[];

test("cues: a frame's end motion ends before its frame leaves", () => {
  const rows: Readonly<Record<string, MotionSpec>> = CUE_MOTIONS;
  const { frameOut } = LAYER_MOTIONS;
  const problems: string[] = [];
  for (const [key, spec] of Object.entries(rows)) {
    const end = (END_ROWS as readonly string[]).includes(key);
    for (const [label, m] of specsOf(key, spec)) {
      const holds = 'holdEnd' in m && m.holdEnd === true;
      const element = PRESET_SITE[m.preset] === 'element';
      if (end && element) {
        if (m.ms > frameOut.ms) {
          problems.push(`${label}: ${m.ms} ms > frameOut ${frameOut.ms} ms`);
        }
        // The reduced preset plays with the motion's own `ms` (§8.6).
        if (m.ms > frameOut.reduced.ms) {
          problems.push(`${label}: ${m.ms} ms > frameOut reduced ${frameOut.reduced.ms} ms`);
        }
        if (!holds) {
          problems.push(`${label}: an end motion without holdEnd`);
        }
      } else if (holds) {
        problems.push(`${label}: holdEnd outside an end row's element-site motion`);
      }
    }
  }
  expect(problems).toEqual([]);
});

test("motions: the puzzle frame's entrance lasts FRAME_OPEN_MS", () => {
  expect(LAYER_MOTIONS.in.ms).toBe(FRAME_OPEN_MS);
  expect(LAYER_MOTIONS.in.reduced.ms).toBeLessThanOrEqual(FRAME_OPEN_MS);
});

/** Each WorldState field with the fact kinds whose changes it carries; a silent field carries none (tsc: every field,
 *  and no other). */
const FIELD_FACTS = {
  format: [],
  section: [],
  room: [],
  lastRoom: [],
  visited: ['visited'],
  held: ['held'],
  used: ['used'],
  docs: ['doc'],
  taken: ['taken'],
  examined: ['examined'],
  slots: ['slot'],
  open: ['open'],
  fired: ['fired'],
  pendingStory: ['story'],
  puzzles: ['solved', 'failed', 'abandoned', 'attempt', 'hint'],
  unproved: [],
  flags: [],
} as const satisfies Record<keyof WorldState, readonly FactKind[]>;

test('cues: every world field is a fact kind or silent', () => {
  const table: Readonly<Record<string, readonly string[]>> = FIELD_FACTS;
  const silent: Readonly<Record<string, string>> = SILENT_FIELDS;
  const kinds = new Set(factKinds());
  // Non-vacuous: the real state's fields and the test's table, so a field either side adds is judged.
  const fields = [...new Set([...Object.keys(EMPTY_WORLD_STATE), ...Object.keys(table)])];
  expect(fields.length).toBeGreaterThan(15);
  const problems: string[] = [];
  for (const field of fields) {
    const facts = table[field] ?? [];
    const isSilent = Object.hasOwn(silent, field);
    if (facts.length > 0 && isSilent) {
      problems.push(`${field}: both a fact field and silent`);
    } else if (facts.length === 0 && !isSilent) {
      problems.push(`${field}: neither a fact kind field nor silent`);
    }
    for (const kind of facts) {
      if (!kinds.has(kind)) {
        problems.push(`${field}: ${kind} is no fact kind`);
      }
    }
  }
  expect(problems).toEqual([]);
});

/** A fixture type that declares its controls, with its literal type kept (`satisfies`). */
const FIXTURE_TYPE = {
  type: 'fixture',
  check: 'commit',
  goal: 'secret',
  presentation: 'overlay',
  wrong: 'posted',
  commit: 'control',
  decodeParams: () => ({ ok: true, value: null }),
  answerShape: () => ({ len: 1, max: 1 }),
  initial: () => [0],
  startShown: () => null,
  controls: [
    { name: 'fixture-pull', on: 'pointerdown', motion: 'wobble', haptic: 'light' },
    { name: 'fixture-trace', on: 'gesture' },
  ],
} as const satisfies PuzzleTypeData<'fixture', null>;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** The names a registry would derive `ControlCue` from (tsc: a widened `string` is a compile error here). */
const DERIVED: Equal<(typeof FIXTURE_TYPE)['controls'][number]['name'], 'fixture-pull' | 'fixture-trace'> = true;

test('cues: a declared control resolves its motion', () => {
  expect(DERIVED).toBe(true);
  const declared = FIXTURE_TYPE.controls;
  // A fixture type's names join `ControlCue` only through the registry; the test passes its type's controls.
  const pull = uiMotion('fixture-pull' as ControlCue, declared);
  expect(pull).toEqual({ ...UI_MOTIONS.control, preset: 'wobble', haptic: 'light' });
  // A gesture control without its own preset plays the gesture default.
  expect(uiMotion('fixture-trace' as ControlCue, declared)).toEqual(UI_MOTIONS.gesture);
  // A core control plays its override, or the control default.
  expect(uiMotion('bare-art', declared)).toBe(UI_MOTIONS.overrides['bare-art']);
  expect(uiMotion('puzzle-try', declared)).toBe(UI_MOTIONS.control);
  // The registries declare no control today: the default resolves the core controls as before.
  expect(declaredControls()).toEqual([]);
  expect(uiMotion('ribbon-item')).toBe(UI_MOTIONS.overrides['ribbon-item']);
});
