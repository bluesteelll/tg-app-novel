// The story runner (PROTOTYPE-PLAN "story/runner.ts", PUZZLES-PLAN X1, STAGING-DSL §3.5): the only importer of the
// inkjs runtime in src/, never `inkjs/full`. It turns ink's Continue() into displayed steps: a tag-only step merges into
// the next line or choice set, a yield block stops as a yield step, and every ink failure is an error value, never a
// throw at this module's edge. It emits steps and staging commands only: no Pixi, GSAP, Svelte or scene (principle 7).
import { Story } from 'inkjs';

import type { InkScalar, LoadedChapter, Result } from './catalog.ts';
import type { AssetIndex, KnotName, LineId, SpeakerId, StagingCommand, TagError, VarName, YieldCommand } from './staging.ts';
import { YIELD_KINDS, parseTags, splitSpeaker } from './tags.ts';

/** One displayed step: a line, a choice set, the yield the story stopped at, or the end of the chapter's flow. */
export type RunnerStep =
  | { kind: 'line'; lineId: LineId; speaker: SpeakerId | null; ru: string; commands: StagingCommand[]; knot: KnotName; enteredKnot: boolean }
  | { kind: 'choices'; choices: ReadonlyArray<{ index: number; lineId: LineId; ru: string }>; commands: StagingCommand[]; knot: KnotName; enteredKnot: boolean }
  | { kind: 'yield'; yield: YieldCommand; commands: StagingCommand[]; knot: KnotName; enteredKnot: boolean }
  | { kind: 'end'; commands: StagingCommand[] };
/**
 * `ink`, `no-id` and `load` are terminal (every later call returns the same error); `tags` is not (`current()` holds
 * the step without the bad commands); `bad-choice`, `not-at-yield`, `unknown-knot`, `bad-projection` leave the story
 * where it was.
 */
export type RunnerError =
  | { kind: 'ink'; message: string }
  | { kind: 'tags'; errors: TagError[]; lineId: LineId | null }
  | { kind: 'no-id'; path: string }
  | { kind: 'load'; message: string }
  | { kind: 'not-at-yield' }
  | { kind: 'unknown-knot'; knot: KnotName }
  | { kind: 'bad-projection'; name: VarName; detail: string }
  | { kind: 'bad-choice'; index: number };
/** Where a runner starts: a new chapter with the values carried into it. */
export type StartPoint = { kind: 'fresh'; carry: Readonly<Record<VarName, InkScalar>> };
/** A knot's own container entered at its start, with the VAR values at that moment (before its top `~` logic runs). */
type KnotEntry = { knot: KnotName; vars: Record<VarName, InkScalar> };

/** inkjs `ErrorType.Author` (engine/Error.js): the compiler's TODO note, never a runtime failure. */
const INK_ERROR_AUTHOR = 0;
const DISPOSED: RunnerError = { kind: 'load', message: 'the runner is disposed' };

/** Runners created and not yet disposed (PROTOTYPE-PLAN "Resource lifetime": GameSession holds one). */
let live = 0;

/** The debug counter of undisposed runners. */
export function liveRunners(): number {
  return live;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isYield(c: StagingCommand): c is YieldCommand {
  return YIELD_KINDS.some((k) => k === c.kind);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A Story over the chapter's parsed ink JSON (or its text); the constructor's version check is a `load` error. */
function newStory(json: unknown): Result<Story, RunnerError> {
  try {
    if (typeof json === 'string') {
      return { ok: true, value: new Story(json) };
    }
    if (isObject(json)) {
      return { ok: true, value: new Story(json) };
    }
    return { ok: false, error: { kind: 'load', message: 'the chapter story is not ink JSON' } };
  } catch (e) {
    return { ok: false, error: { kind: 'load', message: message(e) } };
  }
}

/** Writes `values` into the story's globals; a name the story does not declare is a `load` error. */
function writeVars(story: Story, values: Readonly<Record<VarName, InkScalar>>): Result<void, RunnerError> {
  try {
    for (const [name, v] of Object.entries(values)) {
      story.variablesState.$(name, v);
    }
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: { kind: 'load', message: message(e) } };
  }
}

/** One chapter's inkjs Story, owned: `dispose()` drops it. */
export class StoryRunner {
  #story: Story | null;
  readonly #ch: LoadedChapter;
  readonly #assets: AssetIndex;
  /** What inkjs reported through onError during the last Continue() (never an Author note). */
  readonly #inkErrors: string[] = [];
  /** The tags of the tag-only steps since the last displayed step (§3.5). */
  #pending: string[] = [];
  #current: RunnerStep | null = null;
  #poison: RunnerError | null = null;
  /** The knot of the last displayed step; null before the first. */
  #knot: KnotName | null = null;
  /** A host ChoosePathString since the last step (enter(), a checkpoint start): the next step is a knot entry (Q4). */
  #hostEntry = false;
  /** Since the last displayed step: the last container visited inside a knot of the index. */
  #lastVisited: KnotName | null = null;
  /** Since the last displayed step: every knot entered at its top, lookahead included (ink rolls that back). */
  #entries: KnotEntry[] = [];
  /** The VAR values at the top of the knot the last entry step reported. */
  #checkpoint: Record<VarName, InkScalar> = {};

  private constructor(story: Story, ch: LoadedChapter, assets: AssetIndex) {
    this.#story = story;
    this.#ch = ch;
    this.#assets = assets;
    // With a handler set, inkjs reports instead of throwing a StoryException out of Continue().
    story.onError = (msg, type): void => {
      if (type !== INK_ERROR_AUTHOR) {
        this.#inkErrors.push(msg);
      }
    };
    // The story gate's wrap (playthrough.ts): a step whose pointer ink has already nulled (a line before `-> END`, a
    // choice set) is placed by the containers visited, and a knot's own top snapshots the VARs for its checkpoint.
    const visit = story.VisitContainer.bind(story);
    story.VisitContainer = (container, atStart): void => {
      this.#visited(container.path.head?.name ?? null, container.path.componentCount, atStart);
      visit(container, atStart);
    };
    live += 1;
  }

  /** A runner at `start`; nothing is counted for a start that fails. */
  static create(ch: LoadedChapter, start: StartPoint, assets: AssetIndex): Result<StoryRunner, RunnerError> {
    const story = newStory(ch.story);
    if (!story.ok) {
      return story;
    }
    const written = writeVars(story.value, start.carry);
    if (!written.ok) {
      return written;
    }
    return { ok: true, value: new StoryRunner(story.value, ch, assets) };
  }

  /** The next displayed step. At a stop (choices, yield, end) it returns that step again and runs no ink. */
  next(): Result<RunnerStep, RunnerError> {
    const story = this.#live();
    if (!story.ok) {
      return story;
    }
    const current = this.#current;
    if (current !== null && current.kind !== 'line') {
      return { ok: true, value: current };
    }
    try {
      return this.#advance(story.value);
    } catch (e) {
      return this.#fail({ kind: 'ink', message: message(e) });
    }
  }

  /** Takes the offered choice `index`; anything else is `bad-choice` and moves nothing. */
  choose(index: number): Result<void, RunnerError> {
    const story = this.#live();
    if (!story.ok) {
      return story;
    }
    const current = this.#current;
    if (current?.kind !== 'choices' || !current.choices.some((c) => c.index === index)) {
      return { ok: false, error: { kind: 'bad-choice', index } };
    }
    try {
      story.value.ChooseChoiceIndex(index);
    } catch (e) {
      return this.#fail({ kind: 'ink', message: message(e) });
    }
    this.#current = null;
    return { ok: true, value: undefined };
  }

  /**
   * Leaves the yield the story stands at (PUZZLES-PLAN X2): writes the projection, then enters `knot` at its top, so
   * the knot's first choice conditions already see the outcome. Every name must be a VAR of the chapter holding a
   * value of the same type; any refusal moves nothing.
   */
  enter(knot: KnotName, projection: Readonly<Record<VarName, InkScalar>>): Result<void, RunnerError> {
    const story = this.#live();
    if (!story.ok) {
      return story;
    }
    if (this.#current?.kind !== 'yield') {
      return { ok: false, error: { kind: 'not-at-yield' } };
    }
    if (!Object.hasOwn(this.#ch.meta.knots, knot)) {
      return { ok: false, error: { kind: 'unknown-knot', knot } };
    }
    const vars = story.value.variablesState;
    for (const [name, v] of Object.entries(projection)) {
      if (!this.#ch.meta.vars.some((declared) => declared === name)) {
        return { ok: false, error: { kind: 'bad-projection', name: name as VarName, detail: `not a VAR of ${this.#ch.id}` } };
      }
      const now: unknown = vars.$(name);
      if (typeof now !== typeof v) {
        return { ok: false, error: { kind: 'bad-projection', name: name as VarName, detail: `a ${typeof v} for a ${typeof now} VAR` } };
      }
    }
    this.#clearTrail();
    try {
      for (const [name, v] of Object.entries(projection)) {
        vars.$(name, v);
      }
      story.value.ChoosePathString(knot); // visits the knot's top after the writes: its entry sees the outcome
    } catch (e) {
      return this.#fail({ kind: 'ink', message: message(e) });
    }
    this.#current = null;
    this.#pending = [];
    this.#hostEntry = true;
    return { ok: true, value: undefined };
  }

  /** The step last returned (after a `tags` error: that step without the bad commands). */
  current(): RunnerStep | null {
    return this.#current;
  }

  /** The current values of `names`; a name the story does not declare is left out. */
  readVars(names: readonly VarName[]): Record<VarName, InkScalar> {
    const out: Record<VarName, InkScalar> = {};
    const story = this.#story;
    if (story === null) {
      return out;
    }
    for (const name of names) {
      const v: unknown = story.variablesState.$(name);
      if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
        out[name] = v;
      }
    }
    return out;
  }

  /**
   * The VAR values at the top of the knot the last `enteredKnot` step reported, before the knot's own `~` logic ran:
   * what a checkpoint restores before it replays that knot from its top (so the knot-top logic runs once).
   */
  checkpointVars(): Record<VarName, InkScalar> {
    return { ...this.#checkpoint };
  }

  /** Idempotent; the Story is dropped and every later call returns an error. */
  dispose(): void {
    if (this.#story === null) {
      return;
    }
    this.#story.onError = null;
    this.#story = null;
    this.#pending = [];
    this.#current = null;
    this.#clearTrail();
    live -= 1;
  }

  #live(): Result<Story, RunnerError> {
    if (this.#poison !== null) {
      return { ok: false, error: this.#poison };
    }
    if (this.#story === null) {
      return { ok: false, error: DISPOSED };
    }
    return { ok: true, value: this.#story };
  }

  #fail(error: RunnerError): { ok: false; error: RunnerError } {
    this.#poison = error;
    this.#current = null;
    return { ok: false, error };
  }

  #show(step: RunnerStep, errors: readonly TagError[], lineId: LineId | null): Result<RunnerStep, RunnerError> {
    this.#current = step;
    return errors.length > 0 ? { ok: false, error: { kind: 'tags', errors: [...errors], lineId } } : { ok: true, value: step };
  }

  #isKnot(name: string): name is KnotName {
    return Object.hasOwn(this.#ch.meta.knots, name); // the meta decoder checked every key's grammar
  }

  /** The VisitContainer hook: only containers inside a knot of the index count; only the knot itself is an entry. */
  #visited(head: string | null, depth: number, atStart: boolean): void {
    if (head === null || !this.#isKnot(head)) {
      return;
    }
    this.#lastVisited = head;
    if (atStart && depth === 1) {
      this.#entries.push({ knot: head, vars: this.readVars(this.#ch.meta.vars) });
    }
  }

  #clearTrail(): void {
    this.#hostEntry = false;
    this.#lastVisited = null;
    this.#entries = [];
  }

  /**
   * The knot a step is in (D4): the pointer's knot while ink still points into the story (its snapshot rollback has
   * undone any lookahead); at a null pointer, the last container this step visited; else the previous step's knot.
   */
  #knotAt(path: string | null): KnotName {
    const fallback = this.#knot ?? this.#ch.meta.firstKnot;
    if (path !== null) {
      const head = path.split('.')[0] ?? '';
      return this.#isKnot(head) ? head : fallback;
    }
    return this.#lastVisited ?? fallback;
  }

  /**
   * Places a displayed step in `knot` and says whether it entered it. On an entry the checkpoint takes the first top
   * entry of that same knot since the last step: an entry of another knot was lookahead, and a knot entered other
   * than at its top keeps the values now.
   */
  #place(knot: KnotName): boolean {
    const entered = this.#hostEntry || knot !== this.#knot;
    if (entered) {
      this.#checkpoint = this.#entries.find((e) => e.knot === knot)?.vars ?? this.readVars(this.#ch.meta.vars);
    }
    this.#knot = knot;
    this.#clearTrail();
    return entered;
  }

  /** Continue() until a text line or a stop (the merge loop of the story gate, playthrough.ts). */
  #advance(story: Story): Result<RunnerStep, RunnerError> {
    while (story.canContinue) {
      const text = (story.Continue() ?? '').trim();
      const inkError = this.#inkErrors[0];
      if (inkError !== undefined) {
        return this.#fail({ kind: 'ink', message: inkError });
      }
      const tags = story.currentTags ?? [];
      if (text === '') {
        this.#pending.push(...tags); // a tag-only step joins the next displayed step's batch (§3.5)
        continue;
      }
      const parsed = parseTags([...this.#pending, ...tags], this.#assets);
      this.#pending = [];
      const path = story.state.currentPathString;
      if (parsed.lineId === null) {
        return this.#fail({ kind: 'no-id', path: path ?? this.#knotAt(null) });
      }
      const shown = splitSpeaker(text);
      // The speaker brand is earned by SPEAKER_RE inside splitSpeaker; the cast check is the story lint's.
      const speaker = shown.speaker as SpeakerId | null;
      const knot = this.#knotAt(path);
      const enteredKnot = this.#place(knot);
      const step: RunnerStep = { kind: 'line', lineId: parsed.lineId, speaker, ru: shown.text, commands: parsed.commands, knot, enteredKnot };
      return this.#show(step, parsed.errors, parsed.lineId);
    }
    return this.#stop(story);
  }

  /** The stop: the batch left over is the choice set's, the yield's, or the end's (§3.5). */
  #stop(story: Story): Result<RunnerStep, RunnerError> {
    const batch = parseTags(this.#pending, this.#assets);
    this.#pending = [];
    const offered = story.currentChoices;
    const first = offered[0];
    if (first !== undefined) {
      const errors = [...batch.errors];
      const choices: Array<{ index: number; lineId: LineId; ru: string }> = [];
      for (const c of offered) {
        const own = parseTags(c.tags ?? [], this.#assets); // only `id` is allowed inside the brackets (§3.4)
        if (own.lineId === null) {
          return this.#fail({ kind: 'no-id', path: c.sourcePath });
        }
        errors.push(...own.errors);
        choices.push({ index: c.index, lineId: own.lineId, ru: c.text });
      }
      // ink has nulled the pointer at a choice set; the choice's own source path still names its knot.
      const knot = this.#knotAt(first.sourcePath);
      const enteredKnot = this.#place(knot);
      return this.#show({ kind: 'choices', choices, commands: batch.commands, knot, enteredKnot }, errors, null);
    }
    // A yield block ends at `-> DONE` (PUZZLES-PLAN X1): the story cannot continue and no choice is offered.
    const y = batch.commands.find(isYield);
    if (y !== undefined) {
      const commands = batch.commands.filter((c) => c !== y);
      const knot = this.#knotAt(story.state.currentPathString);
      const enteredKnot = this.#place(knot);
      return this.#show({ kind: 'yield', yield: y, commands, knot, enteredKnot }, batch.errors, null);
    }
    this.#clearTrail();
    return this.#show({ kind: 'end', commands: batch.commands }, batch.errors, null);
  }
}
