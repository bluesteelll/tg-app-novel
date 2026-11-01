// Resume (PROTOTYPE-PLAN "Save format and resume", PUZZLES-PLAN X9 / F9): a save body back into a runner, at the exact
// step, at the last knot's top, or at the chapter start, never by a throw (T5). A level that fails, a version mismatch
// and a removed knot step down one level; the chapter start is the floor. Every level the save reaches past the
// chapter start passes the saved world through reconcile. Synchronous: the caller shows its loading state first.
import { reconcile } from '../explore/reconcile.ts';
import { EMPTY_WORLD_STATE } from '../explore/state.ts';
import type { WorldState } from '../explore/state.ts';
import { carryInto } from './carry.ts';
import type { InkScalar, LoadedChapter, Result } from './catalog.ts';
import { StoryRunner } from './runner.ts';
import type { RunnerError, RunnerStep, StartPoint } from './runner.ts';
import type { SaveBodyV1 } from './save-codec.ts';
import { EMPTY_SNAPSHOT } from './staging.ts';
import type { AssetIndex, ChapterId, KnotName, SectionId, StagingSnapshot, VarName } from './staging.ts';

export type ResumeLevel = 'exact' | 'checkpoint' | 'chapter-start';
export type Resumed = {
  level: ResumeLevel;
  /** The save was written at the previous chapter's end (`ink: null`): this chapter starts now. */
  pendingStart: boolean;
  /** A level the caller allowed was skipped (a version mismatch, a removed knot, a failure): the toast. */
  storyUpdated: boolean;
  /** The caller owns it: dispose on chapter change, on loading another save, on a new game. */
  runner: StoryRunner;
  /** The step to show. */
  first: RunnerStep;
  /** The stage to apply with duration 0. */
  staging: StagingSnapshot;
  world: WorldState;
  /** A section whose saved state the current world cannot produce restarted from its entry (the toast). */
  reset: SectionId | null;
  dropped: readonly string[];
};
export type ResumeError =
  | { kind: 'wrong-chapter'; body: ChapterId; chapter: ChapterId }
  /** The chapter-start floor failed: the chapter itself is broken. */
  | { kind: 'runner'; error: RunnerError };

const RANK: Readonly<Record<ResumeLevel, number>> = { exact: 0, checkpoint: 1, 'chapter-start': 2 };

type Started = { runner: StoryRunner; first: RunnerStep };
type World = Pick<Resumed, 'world' | 'reset' | 'dropped'>;

/**
 * A runner at `start` with its first step: an exact start's rebuilt step, else the first `next()`. A `tags` error keeps
 * the level (the step stands without the bad commands); any other error disposes the runner.
 */
function started(ch: LoadedChapter, start: StartPoint, assets: AssetIndex): Result<Started, RunnerError> {
  const made = StoryRunner.create(ch, start, assets);
  if (!made.ok) {
    return made;
  }
  const runner = made.value;
  const rebuilt = start.kind === 'exact' ? runner.current() : null;
  if (rebuilt !== null) {
    return { ok: true, value: { runner, first: rebuilt } };
  }
  const step = runner.next();
  if (step.ok) {
    return { ok: true, value: { runner, first: step.value } };
  }
  const shown = runner.current();
  if (step.error.kind === 'tags' && shown !== null) {
    return { ok: true, value: { runner, first: shown } };
  }
  runner.dispose();
  return step;
}

/** The saved world as the current world can play it (X9); a chapter without a world plays none. */
function reconciled(body: SaveBodyV1, ch: LoadedChapter): World {
  if (ch.world === null) {
    return { world: EMPTY_WORLD_STATE, reset: null, dropped: [] };
  }
  const knots = new Set(Object.keys(ch.meta.knots) as KnotName[]); // the keys of the decoded knot index
  const r = reconcile(ch.world, body.world, knots, body.worldVersion);
  return { world: r.state, reset: r.reset, dropped: r.dropped };
}

/** The saved checkpoint vars the chapter still declares (a VAR a story update removed is not written). */
function declaredVars(vars: Readonly<Record<VarName, InkScalar>>, declared: readonly VarName[]): Record<VarName, InkScalar> {
  const out: Record<VarName, InkScalar> = {};
  for (const name of declared) {
    if (Object.hasOwn(vars, name)) {
      const v = vars[name];
      if (v !== undefined) {
        out[name] = v;
      }
    }
  }
  return out;
}

function chapterStart(body: SaveBodyV1, ch: LoadedChapter, assets: AssetIndex, pendingStart: boolean, storyUpdated: boolean): Result<Resumed, ResumeError> {
  const at = started(ch, { kind: 'fresh', carry: carryInto(body.chapterStart.carry, ch.meta) }, assets);
  if (!at.ok) {
    return { ok: false, error: { kind: 'runner', error: at.error } };
  }
  const world: World = { world: EMPTY_WORLD_STATE, reset: null, dropped: [] };
  return { ok: true, value: { level: 'chapter-start', pendingStart, storyUpdated, ...at.value, staging: EMPTY_SNAPSHOT, ...world } };
}

/**
 * `body` back into a runner of `ch`, from `minLevel` (`'exact'` by default; the error floor passes a lower one) down
 * to the chapter start. Only the floor failing is an error, besides a body of another chapter.
 */
export function resume(body: SaveBodyV1, ch: LoadedChapter, assets: AssetIndex, o: { minLevel?: ResumeLevel } = {}): Result<Resumed, ResumeError> {
  if (body.chapterId !== ch.id) {
    return { ok: false, error: { kind: 'wrong-chapter', body: body.chapterId, chapter: ch.id } };
  }
  if (body.ink === null) {
    return chapterStart(body, ch, assets, true, false);
  }
  const min = RANK[o.minLevel ?? 'exact'];
  let storyUpdated = false;
  if (min <= RANK.exact) {
    // A version mismatch skips the exact level: a removed line before the cursor would resume at the wrong line.
    if (body.storyVersion === ch.meta.storyVersion) {
      const at = started(ch, { kind: 'exact', ink: body.ink, atYield: body.at.yield, lineId: body.at.lineId, knot: body.at.knot }, assets);
      if (at.ok) {
        return { ok: true, value: { level: 'exact', pendingStart: false, storyUpdated, ...at.value, staging: body.staging, ...reconciled(body, ch) } };
      }
    }
    storyUpdated = true;
  }
  const checkpoint = body.checkpoint;
  if (min <= RANK.checkpoint && checkpoint !== null) {
    if (Object.hasOwn(ch.meta.knots, checkpoint.knot)) {
      const vars = declaredVars(checkpoint.vars, ch.meta.vars);
      const at = started(ch, { kind: 'checkpoint', knot: checkpoint.knot, vars }, assets);
      if (at.ok) {
        return {
          ok: true,
          value: { level: 'checkpoint', pendingStart: false, storyUpdated, ...at.value, staging: checkpoint.staging, ...reconciled(body, ch) },
        };
      }
    }
    storyUpdated = true;
  }
  return chapterStart(body, ch, assets, false, storyUpdated);
}
