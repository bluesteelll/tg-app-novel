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

  /** The step last returned (after a `tags` error: that step without the bad commands). */
  current(): RunnerStep | null {
    return this.#current;
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

  /** Continue() until a text line or a stop (the merge loop of the story gate, playthrough.ts). */
  #advance(story: Story): Result<RunnerStep, RunnerError> {
    const knot = this.#ch.meta.firstKnot;
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
      if (parsed.lineId === null) {
        return this.#fail({ kind: 'no-id', path: story.state.currentPathString ?? knot });
      }
      const shown = splitSpeaker(text);
      // The speaker brand is earned by SPEAKER_RE inside splitSpeaker; the cast check is the story lint's.
      const speaker = shown.speaker as SpeakerId | null;
      const step: RunnerStep = { kind: 'line', lineId: parsed.lineId, speaker, ru: shown.text, commands: parsed.commands, knot, enteredKnot: false };
      return this.#show(step, parsed.errors, parsed.lineId);
    }
    return this.#stop(story, knot);
  }

  /** The stop: the batch left over is the choice set's, the yield's, or the end's (§3.5). */
  #stop(story: Story, knot: KnotName): Result<RunnerStep, RunnerError> {
    const batch = parseTags(this.#pending, this.#assets);
    this.#pending = [];
    const offered = story.currentChoices;
    if (offered.length > 0) {
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
      return this.#show({ kind: 'choices', choices, commands: batch.commands, knot, enteredKnot: false }, errors, null);
    }
    // A yield block ends at `-> DONE` (PUZZLES-PLAN X1): the story cannot continue and no choice is offered.
    const y = batch.commands.find(isYield);
    if (y !== undefined) {
      const commands = batch.commands.filter((c) => c !== y);
      return this.#show({ kind: 'yield', yield: y, commands, knot, enteredKnot: false }, batch.errors, null);
    }
    return this.#show({ kind: 'end', commands: batch.commands }, batch.errors, null);
  }
}
