// The seeded playthroughs of the story gate (STAGING-DSL §11 "Seeded playthroughs", PROTOTYPE-PLAN.md K8): per
// chapter 200 runs (seeds 1-200; mulberry32 picks each choice), each on its own inkjs Story. A run checks every
// displayed step (tags parse as one batch, the line has an ID, a runtime-only ID has an en entry and a cast speaker),
// and ends at `-> END` (ended: it credits its last knot and leaves a carry), at a yield (yielded: no ending, no carry,
// until LW3 plays through yields) or on an error or a step cap (failed). Per chapter: the knots no run entered and the
// endings no run reached. Pure, no node:*: the story tool's only importer of the inkjs RUNTIME ('inkjs').
import { Story as UntypedStory } from 'inkjs';
import type { InkObject } from 'inkjs/engine/Object';
import type { Story as InkStory } from 'inkjs/engine/Story';
import type { AbstractValue } from 'inkjs/engine/Value';

import { CHAPTER_ID_RE, KNOT_NAME_RE } from '../../src/story/catalog.ts';
import type { Cast, ChapterListEntry, InkScalar } from '../../src/story/catalog.ts';
import type { AssetIndex, ChapterId, KnotName, ParsedTags, StagingCommand, VarName, YieldCommand } from '../../src/story/staging.ts';
import { YIELD_KINDS, parseTags, splitSpeaker } from '../../src/story/tags.ts';
import type { ChapterGraph, StoryLine } from './graph.ts';
import { LINT_CODES } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';
import type { EnEntry } from './locales.ts';

// inkjs's ink.d.mts re-exports through extensionless paths, which `module: nodenext` does not resolve, so the binding
// arrives as `any`; the package's CJS typings of the same class give it its real type (as compile.ts does).
const Story: typeof InkStory = UntypedStory;

/** Runs per chapter: seeds 1..PLAY_RUNS (STAGING-DSL §11). */
export const PLAY_RUNS = 200;
/** `Continue()` calls per run (STAGING-DSL §11): past it the run fails `play/step-cap` (a loop, not a timeout). */
export const STEP_CAP = 5_000;
/**
 * inkjs `Step()` calls inside ONE `Continue()`: a loop that never outputs a line never returns from `Continue()`, and a
 * knot that diverts to itself re-enters no container (inkjs counts only containers it was not already in), so the
 * runtime's steps are what is counted.
 */
export const INK_STEPS_PER_CONTINUE_CAP = 10_000;
// inkjs `ValueType.Int` / `ValueType.Float` and `ErrorType.Author` (engine/Value.js, engine/Error.js): its numeric
// enums are runtime objects the typings-only imports cannot reach, so the values are restated here.
const INK_INT = 0;
const INK_FLOAT = 1;
const INK_ERROR_AUTHOR = 0;
/** What the step wrapper throws: never a StoryException, so inkjs re-throws it out of `Continue()`. */
const INK_STEP_CAP_HIT = Symbol('ink step cap');
const EXCERPT_CHARS = 60;

/** mulberry32 (bryc, github.com/bryc/code jshash/PRNGs.md "Mulberry32"): uniform in [0, 1) from a 32-bit state. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The carry set's values at a run's end: the g_ globals that hold a scalar (STAGING-DSL §9). */
export type CarrySnapshot = Readonly<Record<VarName, InkScalar>>;
/** One ended run's carry (STORIES-PLAN SQ6): the knot whose `-> END` ended it, and the g_ values it left. */
export type Carry = { knot: KnotName; vars: CarrySnapshot };
/** story/lint-allow.json decoded: `<chapter>.<knot>` → the reason it may stay unvisited. */
export type Allow = ReadonlyMap<string, string>;
export type ChapterPlay = {
  chapter: ChapterId;
  runs: number;
  ended: number;
  yielded: number;
  failed: number;
  /** Knots some run entered, in first-entry order. */
  visited: ReadonlySet<KnotName>;
  /** Ending knots some ended run credited. */
  endings: ReadonlySet<KnotName>;
  /** One per ended run, in seed order: the successor's input. */
  carries: readonly Carry[];
  /** The chapter whose carries were offered; null when the runs started from the declared defaults. */
  carriedFrom: ChapterId | null;
  /** How many snapshots that chapter offered: 0 means it left none, so the runs used the declared defaults. */
  carrySnapshots: number;
};
export type PlayInput = {
  chapter: SourceChapter;
  json: string;
  graph: ChapterGraph;
  assets: AssetIndex;
  cast: Cast;
  /** The chapter's decoded en table. */
  en: ReadonlyMap<string, EnEntry>;
  /** The IDs of `graph.lines`: the localization stage already judged them, so a run checks only the others. */
  staticIds: ReadonlySet<string>;
  allow: Allow;
  /** The predecessor's carries; run s takes snapshot (s - 1) mod n. */
  carry: { from: ChapterId; snapshots: readonly CarrySnapshot[] } | null;
  /** Tests only; the CLI plays PLAY_RUNS. */
  runs?: number;
};

export const ALLOW_FILE = 'lint-allow.json';
const ALLOW_SECTION = 'play/knot-not-visited';
const BOM = String.fromCharCode(0xfeff);

function finding(code: LintCode, file: string, line: number, message: string): Finding {
  return { code, severity: LINT_CODES[code], file, line, message };
}

function isObject(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The 1-based line of the first `"<key>":` at or after line `from` of `text`, or 0 when it is not written plainly. */
function keyLine(text: string, key: string, from = 1): number {
  const lines = text.split('\n');
  const needle = new RegExp(`${JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
  for (let i = Math.max(from, 1) - 1; i < lines.length; i += 1) {
    if (needle.test(lines[i] ?? '')) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Decodes story/lint-allow.json: exactly `{ "play/knot-not-visited": { "<chapter>.<knot>": "<reason>" } }`. A missing
 * file (`text` null) allows nothing. Every malformed part is a `play/knot-not-visited` finding on its key's line (0 for
 * the whole file) and allows nothing. An entry is judged against the list only when it decoded (`chapters` non-null),
 * and against a chapter's knots only when that chapter compiled (it is in `graphs`).
 */
export function decodeAllow(
  text: string | null,
  chapters: readonly ChapterListEntry[] | null,
  graphs: ReadonlyMap<ChapterId, ChapterGraph>,
): { allow: Allow; findings: Finding[] } {
  const allow = new Map<string, string>();
  const findings: Finding[] = [];
  if (text === null) {
    return { allow, findings };
  }
  const report = (line: number, message: string): void => {
    findings.push(finding(ALLOW_SECTION, ALLOW_FILE, line, `${message} (STAGING-DSL §11)`));
  };
  const shape = `{ "${ALLOW_SECTION}": { "<chapter>.<knot>": "<reason>" } }`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
  } catch (e) {
    report(0, `not JSON: ${e instanceof Error ? e.message : String(e)}; nothing in it is read`);
    return { allow, findings };
  }
  if (!isObject(parsed)) {
    report(0, `not a JSON object ${shape}; nothing in it is read`);
    return { allow, findings };
  }
  const listed = chapters === null ? null : new Set<string>(chapters.map((c) => c.id));
  for (const [key, section] of Object.entries(parsed)) {
    const sectionLine = keyLine(text, key);
    if (key !== ALLOW_SECTION) {
      report(sectionLine, `'${key}': unknown key (expected '${ALLOW_SECTION}')`);
      continue;
    }
    if (!isObject(section)) {
      report(sectionLine, `'${key}' is not an object ${shape}`);
      continue;
    }
    for (const [entry, reason] of Object.entries(section)) {
      const line = keyLine(text, entry, sectionLine);
      const dot = entry.indexOf('.');
      const ch = entry.slice(0, Math.max(dot, 0));
      const knot = entry.slice(dot + 1);
      if (dot < 0 || !CHAPTER_ID_RE.test(ch) || !KNOT_NAME_RE.test(knot)) {
        report(line, `'${entry}' is not '<chapter>.<knot>'`);
      } else if (typeof reason !== 'string' || reason.trim() === '') {
        report(line, `'${entry}': the reason must be a non-empty string`);
      } else if (listed !== null && !listed.has(ch)) {
        report(line, `'${entry}': ${ch} is not a listed chapter`);
      } else if ([...graphs].some(([id, g]) => id === ch && ![...g.knots.keys()].some((k) => k === knot))) {
        report(line, `'${entry}': ${ch} has no knot '${knot}'`);
      } else {
        allow.set(entry, reason);
      }
    }
  }
  return { allow, findings };
}

/** A finding of one run, before the runs are aggregated. */
type RunFinding = { code: LintCode; file: string; line: number; detail: string };
type Run = { outcome: 'ended' | 'yielded' | 'failed'; visited: ReadonlySet<KnotName>; carry: Carry | null; findings: RunFinding[]; choices: readonly number[] };
type Context = { input: PlayInput; knots: ReadonlyMap<string, KnotName>; lines: ReadonlyMap<string, StoryLine> };

/** The object as an ink value: a variable's slot holds a Value (engine/Value.js), never another InkObject. */
function isInkValue(o: InkObject): o is AbstractValue {
  // A structural check: the runtime classes live inside dist/ink.mjs, so `instanceof` would need a second engine copy.
  return 'valueType' in o && typeof o.valueType === 'number' && 'Cast' in o && typeof o.Cast === 'function';
}

/**
 * Writes a predecessor's carry into a fresh story. JS cannot tell 2 from 2.0 and inkjs stores an integral number as an
 * Int (`Value.Create` with no preferred type), so a number written into a Float-declared global is re-typed: else
 * `g_ratio / 4` would divide as integers. The declared type is in the one shared globals.ink, so both chapters agree.
 */
function writeCarry(story: InkStory, globals: readonly VarName[], snapshot: CarrySnapshot): void {
  const vars = story.variablesState;
  for (const g of globals) {
    const v = snapshot[g];
    if (v === undefined) {
      continue;
    }
    vars.$(g, v);
    if (typeof v !== 'number') {
      continue;
    }
    const declared = vars.TryGetDefaultVariableValue(g);
    const written = vars.GetVariableWithName(g);
    if (declared !== null && written !== null && isInkValue(declared) && isInkValue(written) && declared.valueType === INK_FLOAT && written.valueType === INK_INT) {
      vars.SetGlobal(g, written.Cast(INK_FLOAT));
    }
  }
}

function carryOf(story: InkStory, globals: readonly VarName[]): CarrySnapshot {
  const out: Record<VarName, InkScalar> = {};
  for (const g of globals) {
    const v = story.variablesState.$(g);
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      out[g] = v;
    }
  }
  return out;
}

function isYield(c: StagingCommand): c is YieldCommand {
  return YIELD_KINDS.some((k) => k === c.kind);
}

function excerpt(text: string): string {
  return JSON.stringify(text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}…` : text);
}

/**
 * The reasons a batch has only at runtime (§3.5 merges tag-only steps forward, across diverts): a conflict and a second
 * ID. Every other reason is context-free and the source lint judges each literal tag on its own line (§2, §10 forbid
 * dynamic tags), so it is not repeated here.
 */
function batchErrors(parsed: ParsedTags, at: { file: string; line: number }, out: RunFinding[]): void {
  for (const e of parsed.errors) {
    if (e.reason === 'conflict') {
      out.push({ code: 'batch/conflict', ...at, detail: `'${e.tag}' ${e.detail} (the runtime batch)` });
    } else if (e.reason === 'multiple-id') {
      out.push({ code: 'id/multiple', ...at, detail: `'${e.tag}': ${e.detail} (the runtime batch)` });
    }
  }
}

/** The checks a line or choice ID that no source line carries still needs: its en entry and its speaker. */
function runtimeIdChecks(ctx: Context, id: string, text: string | null, at: { file: string; line: number }, out: RunFinding[]): void {
  if (!ctx.input.en.has(id)) {
    out.push({ code: 'loc/missing-en', ...at, detail: `'${id}' (shown at runtime) has no entry in story/locales/en/${ctx.input.chapter.id}.json` });
  }
  const speaker = text === null ? null : splitSpeaker(text).speaker;
  if (speaker !== null && !Object.hasOwn(ctx.input.cast, speaker)) {
    out.push({ code: 'speaker/unknown', ...at, detail: `speaker '${speaker}' (shown at runtime) is not in story/cast.json` });
  }
}

function playRun(ctx: Context, seed: number, snapshot: CarrySnapshot | null): Run {
  const { input } = ctx;
  const entry = { file: input.chapter.entry, line: 0 };
  const story = new Story(input.json);
  story.state.storySeed = seed;
  story.state.previousRandom = 0;
  const rng = mulberry32(seed);
  const trail: { visited: Set<KnotName>; last: KnotName | null } = { visited: new Set(), last: null };
  const visit = story.VisitContainer.bind(story);
  story.VisitContainer = (container, atStart): void => {
    const knot = ctx.knots.get(container.path.head?.name ?? '');
    if (knot !== undefined) {
      trail.visited.add(knot);
      trail.last = knot;
    }
    visit(container, atStart);
  };
  let inkSteps = 0;
  const step = story.Step.bind(story);
  story.Step = (): void => {
    inkSteps += 1;
    if (inkSteps > INK_STEPS_PER_CONTINUE_CAP) {
      throw INK_STEP_CAP_HIT;
    }
    step();
  };
  const errors: string[] = [];
  story.onError = (message, type): void => {
    if (type !== INK_ERROR_AUTHOR) {
      errors.push(message); // an author message is the compiler's `ink/todo`
    }
  };

  const findings: RunFinding[] = [];
  const choices: number[] = [];
  let lastLine: StoryLine | null = null;
  const here = (): { file: string; line: number } => (lastLine === null ? entry : { file: lastLine.file, line: lastLine.line });
  const failed = (code: LintCode, at: { file: string; line: number }, detail: string): Run => {
    findings.push({ code, ...at, detail });
    return { outcome: 'failed', visited: trail.visited, carry: null, findings, choices };
  };
  const capped = (detail: string): Run => {
    const knot = trail.last === null ? undefined : input.graph.knots.get(trail.last);
    return failed('play/step-cap', knot === undefined ? entry : { file: knot.file, line: knot.line }, detail);
  };

  if (snapshot !== null) {
    try {
      writeCarry(story, input.graph.globals, snapshot);
    } catch (e) {
      return failed('play/runtime-error', entry, `the carry could not be written: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let pending: string[] = [];
  let continues = 0;
  try {
    for (;;) {
      while (story.canContinue) {
        inkSteps = 0;
        const text = (story.Continue() ?? '').trim();
        continues += 1;
        const error = errors[0];
        if (error !== undefined) {
          return failed('play/runtime-error', here(), error);
        }
        if (continues > STEP_CAP) {
          return capped(`the run passed ${STEP_CAP} steps: a loop`);
        }
        const tags = story.currentTags ?? [];
        if (text === '') {
          pending.push(...tags); // a tag-only step joins the next displayed step's batch (§3.5)
          continue;
        }
        const parsed = parseTags([...pending, ...tags], input.assets);
        pending = [];
        const line = parsed.lineId === null ? undefined : ctx.lines.get(parsed.lineId);
        if (line !== undefined) {
          lastLine = line;
        }
        batchErrors(parsed, here(), findings);
        if (parsed.lineId === null) {
          findings.push({ code: 'play/line-without-id', ...entry, detail: `a line shown without an id: ${excerpt(text)}` });
        } else if (!input.staticIds.has(parsed.lineId)) {
          runtimeIdChecks(ctx, parsed.lineId, text, here(), findings);
        }
      }
      const offered = story.currentChoices;
      if (offered.length === 0) {
        break;
      }
      // The tag-only steps before a choice set run with it (§3.5): its batch needs no ID, since each choice carries
      // its own (§3.4, §4), and it is consumed here, never merged into the first line after the choice.
      batchErrors(parseTags(pending, input.assets), here(), findings);
      pending = [];
      for (const c of offered) {
        const parsed = parseTags(c.tags ?? [], input.assets);
        if (parsed.lineId === null) {
          findings.push({ code: 'play/line-without-id', ...entry, detail: `a choice shown without an id: ${excerpt(c.text)}` });
        } else if (!input.staticIds.has(parsed.lineId)) {
          runtimeIdChecks(ctx, parsed.lineId, null, here(), findings);
        }
      }
      const pick = Math.floor(rng() * offered.length);
      choices.push(pick);
      story.ChooseChoiceIndex(pick);
    }
  } catch (e) {
    if (e === INK_STEP_CAP_HIT) {
      return capped(`one step ran ${INK_STEPS_PER_CONTINUE_CAP} ink steps without a line: a loop with no text`);
    }
    return failed('play/runtime-error', here(), e instanceof Error ? e.message : String(e));
  }
  // The stop: what is left of the batch is the yield step's (§3.5), or tags after the last line.
  const rest = parseTags(pending, input.assets);
  batchErrors(rest, here(), findings);
  if (rest.commands.some(isYield)) {
    return { outcome: 'yielded', visited: trail.visited, carry: null, findings, choices };
  }
  // `-> END` clears the pointer (StoryState.ForceEnd), so the run's knot is the last one it entered.
  const knot = trail.last;
  if (knot === null) {
    throw new Error('invariant: an ended run entered a knot');
  }
  return { outcome: 'ended', visited: trail.visited, carry: { knot, vars: carryOf(story, input.graph.globals) }, findings, choices };
}

/**
 * Plays one compiled chapter `input.runs ?? PLAY_RUNS` times. A run's findings are aggregated across seeds by code,
 * place and detail; the message names how many runs hit it, the first seed and that seed's choice indices.
 */
export function playChapter(input: PlayInput): { play: ChapterPlay; findings: Finding[] } {
  const runs = input.runs ?? PLAY_RUNS;
  const ctx: Context = {
    input,
    knots: new Map([...input.graph.knots.keys()].map((k) => [k, k])),
    lines: new Map([...input.graph.lines].reverse().map((l) => [l.id, l])), // the first line of an ID wins
  };
  const snapshots = input.carry?.snapshots ?? [];
  const seen = new Map<string, { f: RunFinding; runs: number; seed: number; choices: readonly number[] }>();
  const visited = new Set<KnotName>();
  const endings = new Set<KnotName>();
  const carries: Carry[] = [];
  const counts = { ended: 0, yielded: 0, failed: 0 };
  for (let seed = 1; seed <= runs; seed += 1) {
    const snapshot = snapshots.length === 0 ? null : (snapshots[(seed - 1) % snapshots.length] ?? null);
    const run = playRun(ctx, seed, snapshot);
    counts[run.outcome] += 1;
    for (const k of run.visited) {
      visited.add(k);
    }
    if (run.carry !== null) {
      carries.push(run.carry);
      if (input.graph.knots.get(run.carry.knot)?.ending === true) {
        endings.add(run.carry.knot);
      }
    }
    const once = new Set<string>();
    for (const f of run.findings) {
      const key = JSON.stringify([f.code, f.file, f.line, f.detail]);
      if (once.has(key)) {
        continue;
      }
      once.add(key);
      const prior = seen.get(key);
      if (prior === undefined) {
        seen.set(key, { f, runs: 1, seed, choices: run.choices });
      } else {
        prior.runs += 1;
      }
    }
  }
  const findings = [...seen.values()].map(({ f, runs: k, seed, choices }) =>
    finding(f.code, f.file, f.line, `${f.detail} (${k} of ${runs} runs; first seed ${seed}, choices [${choices.join(', ')}])`),
  );
  for (const [name, node] of input.graph.knots) {
    if (!visited.has(name) && !input.allow.has(`${input.chapter.id}.${name}`)) {
      findings.push(finding('play/knot-not-visited', node.file, node.line, `knot '${name}': no seeded run entered it (${runs} runs; story/${ALLOW_FILE} lists a knot with a reason)`));
    }
  }
  for (const [name, node] of input.graph.knots) {
    if (node.ending && !endings.has(name)) {
      findings.push(finding('play/ending-not-reached', node.file, node.line, `knot '${name}' writes -> END, but no seeded run ended in it (${runs} runs)`));
    }
  }
  const play: ChapterPlay = {
    chapter: input.chapter.id,
    runs,
    ...counts,
    visited,
    endings,
    carries,
    carriedFrom: input.carry?.from ?? null,
    carrySnapshots: snapshots.length,
  };
  return { play, findings };
}

/** The coverage report line of one played chapter (STAGING-DSL §11 "Report"). */
export function coverageLine(p: ChapterPlay, graph: ChapterGraph): string {
  const endings = [...graph.knots.values()].filter((k) => k.ending).length;
  const start = p.carriedFrom === null ? 'defaults' : p.carrySnapshots === 0 ? `defaults: ${p.carriedFrom} left no carry` : `${p.carriedFrom} carries`;
  return `play: ${p.chapter}: ${p.runs} runs, knots ${p.visited.size}/${graph.knots.size}, endings ${p.endings.size}/${endings} (seeds 1-${p.runs}, ${start}; ended ${p.ended}, yielded ${p.yielded}, failed ${p.failed})`;
}
