// The cue player (engine plan §8.5, §8.1 "When a cue's DOM target is found"): plays each cue's overlay motions on
// the DOM in two phases. `capture` runs inside the bus emit and catches every `'emit'` target in the pre-flush DOM;
// `run` runs after the emitting block's flush, finds every `'flush'` target and plays. Cue-stage chunk code, mounted by
// GM3s's CueStage, which supplies the DOM-facing deps. Every Animation, ghost, timer and the one MutationObserver it
// creates ends at its motion's end, its key, its `waited` or `dispose`.
import type { Box } from '../../geom/cover.ts';
import type { CueEvent, CueKey, Haptic } from '../types.ts';
import { cueKey, motionOf } from './motions.ts';
import type { CueTarget, MotionSpec, WithMotion } from './motions.ts';
import { PRESET_SITE, PRESETS, TRAVEL } from './presets.ts';

/** A wait shorter than this shows no hold: the tap's own control cue covers it (§8.1 point 11). */
export const WAIT_DELAY_MS = 120;
/** The side of the stage-centre box a motion with no target plays at: the `centre` landing's size (§8.5, CLAIM). */
const CENTRE_PX = 72;

type Fill = 'none' | 'forwards';
/** One motion of a cue: its first (or cause variant) and each `with` entry. */
type Motion = Pick<MotionSpec, 'preset' | 'ms' | 'target' | 'reduced' | 'resolveAt' | 'holdEnd'> | WithMotion;
/** A target as found: an element with its box, a box with no element (a designed landing), or nothing (both null). */
type Caught = { readonly el: Element | null; readonly box: Box | null };
type Found = { readonly el: Element; readonly box: Box } | { readonly el: null; readonly box: Box };

/** One cue's motions with their `'emit'` targets caught; opaque outside the player. A `'flush'` slot is null. */
export type CuePlan = { readonly e: CueEvent; readonly caught: readonly (Caught | null)[] };
/** What a target resolves to: a live element, a box with no element (a designed landing: `edge`, `centre`, a `ribbon`
 *  or `inventory` target with nothing live), or nothing (played at the stage centre and counted). */
export type Resolved = { readonly el: Element } | { readonly box: Box } | null;

export type CuePlayerDeps = {
  animate(el: Element, kf: Keyframe[], ms: number, fill: Fill): Animation;
  /** The live target now (CueStage's resolver: the §8.5 table, outroing roots skipped). */
  resolve(target: CueTarget, e: CueEvent): Resolved;
  boxOf(el: Element): Box;
  /** A ghost on the stage layer at `box`: a clone of `of` (ids stripped, inert) or, with `of` null, a plain box. */
  ghost(box: Box, of: Element | null): Element;
  reduced(): boolean;
  haptic(h: Haptic): void;
};

export type CuePlayer = {
  /** Synchronous, inside the bus emit: resolves every `'emit'` motion's target (a `control` target: `e.el`, `e.box`). */
  capture(e: CueEvent): CuePlan;
  /** After the emitting block's DOM flush: resolves every `'flush'` target, then plays every motion. */
  run(plan: CuePlan): void;
  /** First motions whose target resolved to nothing (played at the stage centre), and cues whose every motion was
   *  skipped; `with` skips and landings never count. */
  fallbacks(): number;
  /** Cancels every running animation and hold, removes every ghost, disconnects the leave watch. */
  dispose(): void;
};

/** The one `Element.animate` call of the cue stage (rule `waapi`): the `animate` dep CueStage passes. */
export function waapiAnimate(el: Element, kf: Keyframe[], ms: number, fill: Fill): Animation {
  return el.animate(kf, { duration: ms, fill });
}

/** One running animation and what ends with it. */
type Run = {
  readonly anim: Animation;
  readonly el: Element;
  /** A ghost this run owns: removed at its end. */
  readonly ghost: boolean;
  /** An `'emit'` motion on a live element: moved to a ghost when the element leaves. */
  readonly watched: boolean;
  readonly kf: Keyframe[];
  readonly ms: number;
  readonly fill: Fill;
  readonly box: Box;
};
/** A motion played again at each end until it is ended (a `puzzle:checking` loop, a wait hold). */
type Loop = { run: Run | null; ended: boolean; readonly el: Element; readonly ghost: boolean };
/** A wait hold: pending until `WAIT_DELAY_MS`, then shown as a loop on `at`. */
type Hold = { timer: ReturnType<typeof setTimeout> | null; loop: Loop | null; at: Found | null };

const NOTHING: Caught = { el: null, box: null };

function centreOf(stage: Box): Box {
  return { x: stage.x + (stage.w - CENTRE_PX) / 2, y: stage.y + (stage.h - CENTRE_PX) / 2, w: CENTRE_PX, h: CENTRE_PX };
}

function centrePoint(b: Box): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** `kf` moving from (or to) a displacement `d`: each frame's share of the travel by its offset. */
function travelled(kf: readonly Keyframe[], d: { x: number; y: number }, toward: 'from-d' | 'to-d'): Keyframe[] {
  const last = Math.max(kf.length - 1, 1);
  return kf.map((f, i) => {
    const at = typeof f.offset === 'number' ? f.offset : i / last;
    const t = toward === 'from-d' ? 1 - at : at;
    const base = typeof f.transform === 'string' ? ` ${f.transform}` : '';
    return { ...f, transform: `translate(${d.x * t}px, ${d.y * t}px)${base}` };
  });
}

export function createCuePlayer(deps: CuePlayerDeps): CuePlayer {
  const runs = new Set<Run>();
  const loops = new Map<string, { readonly loop: Loop; readonly until: readonly CueKey[] }>();
  let hold: Hold | null = null;
  let observer: MutationObserver | null = null;
  let counted = 0;
  let disposed = false;

  const motionsOf = (e: CueEvent): readonly Motion[] => {
    const first = motionOf(e.cue);
    return [first, ...(first.with ?? [])];
  };
  const isEmit = (m: Motion): boolean => m.resolveAt === 'emit' || m.target === 'control';

  /** The target now: a `control` is the event's element while it has one; every other target is the resolver's. */
  const locate = (target: CueTarget, e: CueEvent): Caught => {
    if (target === 'control' && e.el !== null) {
      return { el: e.el, box: e.box ?? deps.boxOf(e.el) };
    }
    const r = deps.resolve(target, e);
    if (r === null) {
      return NOTHING;
    }
    return 'el' in r ? { el: r.el, box: deps.boxOf(r.el) } : { el: null, box: r.box };
  };
  const found = (c: Caught): Found | null => {
    if (c.box === null) {
      return c.el === null ? null : { el: c.el, box: deps.boxOf(c.el) };
    }
    return c.el === null ? { el: null, box: c.box } : { el: c.el, box: c.box };
  };
  const centre = (e: CueEvent): Found | null => {
    const stage = found(locate('stage', e));
    return stage === null ? null : { el: null, box: centreOf(stage.box) };
  };

  const unwatchIfIdle = (): void => {
    if (observer !== null && ![...runs].some((r) => r.watched)) {
      observer.disconnect();
      observer = null;
    }
  };
  const end = (r: Run): void => {
    runs.delete(r);
    if (r.ghost) {
      r.el.remove();
    }
  };
  const cancel = (r: Run): void => {
    r.anim.cancel();
    end(r);
  };
  const start = (
    el: Element,
    m: { kf: Keyframe[]; ms: number; fill: Fill; box: Box },
    own: { ghost: boolean; watched: boolean },
    then?: () => void,
  ): Run => {
    const anim = deps.animate(el, m.kf, m.ms, m.fill);
    const r: Run = { anim, el, kf: m.kf, ms: m.ms, fill: m.fill, box: m.box, ghost: own.ghost, watched: own.watched };
    r.anim.onfinish = () => {
      end(r);
      unwatchIfIdle();
      then?.();
    };
    runs.add(r);
    if (r.watched && observer === null) {
      observer = new MutationObserver(leave);
      observer.observe(document, { childList: true, subtree: true });
    }
    return r;
  };
  /** The leave watch: a watched motion whose element left continues on its ghost from the same time. */
  function leave(): void {
    for (const r of [...runs]) {
      if (r.watched && !r.el.isConnected) {
        const next = start(deps.ghost(r.box, r.el), r, { ghost: true, watched: false });
        next.anim.currentTime = r.anim.currentTime;
        cancel(r);
      }
    }
    unwatchIfIdle();
  }

  /** Where a motion plays: its element, a ghost of it, a plain box ghost, or nowhere (skipped). */
  const placeOf = (
    m: Motion,
    at: Found,
    landing: boolean,
  ): { readonly el: Element; readonly ghost: boolean; readonly watched: boolean } | null => {
    if (PRESET_SITE[m.preset] === 'element' && at.el !== null) {
      // A hit area paints nothing: its motion plays on a painted ghost of it, from the start (§8.5 "Hit areas").
      if (at.el.closest('[data-cue-hit]') !== null) {
        const g = deps.ghost(at.box, at.el);
        g.classList.add('cue-hit');
        return { el: g, ghost: true, watched: false };
      }
      if (!at.el.isConnected) {
        return { el: deps.ghost(at.box, at.el), ghost: true, watched: false };
      }
      return { el: at.el, ghost: false, watched: isEmit(m) };
    }
    if (PRESET_SITE[m.preset] === 'element' && !landing && (m.target === 'ribbon' || m.target === 'inventory')) {
      // The slot or control it describes is not on screen (`edge`): a plain box there would be an artifact.
      return null;
    }
    const travel = TRAVEL[m.preset] !== undefined && at.el !== null && !deps.reduced();
    return { el: deps.ghost(at.box, travel ? at.el : null), ghost: true, watched: false };
  };
  const keyframesOf = (m: Motion, at: Found, e: CueEvent): Keyframe[] => {
    if (deps.reduced()) {
      return [...PRESETS[m.reduced]];
    }
    const travel = TRAVEL[m.preset];
    if (travel === undefined || e.box === null) {
      return [...PRESETS[m.preset]];
    }
    const from = centrePoint(e.box);
    const to = centrePoint(at.box);
    const d = { x: from.x - to.x, y: from.y - to.y };
    return travelled(PRESETS[m.preset], d, travel === 'to-target' ? 'from-d' : 'to-d');
  };
  /** Plays one motion once; false when it was skipped. */
  const play = (m: Motion, at: Found, e: CueEvent, landing: boolean): boolean => {
    const place = placeOf(m, at, landing);
    if (place === null) {
      return false;
    }
    const fill: Fill = 'holdEnd' in m && m.holdEnd === true ? 'forwards' : 'none';
    start(place.el, { kf: keyframesOf(m, at, e), ms: m.ms, fill, box: at.box }, place);
    return true;
  };
  /** Plays one motion again at each end until `stop` (a hold, a `puzzle:checking` loop); null when skipped. */
  const loop = (m: Motion, at: Found, e: CueEvent, landing: boolean): Loop | null => {
    const place = placeOf(m, at, landing);
    if (place === null) {
      return null;
    }
    const l: Loop = { run: null, ended: false, el: place.el, ghost: place.ghost };
    const kf = keyframesOf(m, at, e);
    const cycle = (): void => {
      if (!l.ended && !disposed) {
        // The loop owns its ghost across cycles, so no cycle removes it.
        l.run = start(l.el, { kf, ms: m.ms, fill: 'none', box: at.box }, { ghost: false, watched: false }, cycle);
      }
    };
    cycle();
    return l;
  };
  const stop = (l: Loop | null): void => {
    if (l === null) {
      return;
    }
    l.ended = true;
    if (l.run !== null && runs.has(l.run)) {
      cancel(l.run);
    }
    if (l.ghost) {
      l.el.remove();
    }
  };
  /** The first motion's target, or the stage centre when it resolved to nothing (counted). */
  const firstAt = (c: Caught, e: CueEvent): { readonly at: Found | null; readonly landing: boolean } => {
    const at = found(c);
    if (at !== null) {
      return { at, landing: false };
    }
    counted += 1;
    return { at: centre(e), landing: true };
  };

  const startHold = (e: CueEvent): void => {
    endHold();
    const h: Hold = { timer: null, loop: null, at: null };
    h.timer = setTimeout(() => {
      h.timer = null;
      const m = motionOf(e.cue);
      const { at, landing } = firstAt(locate(m.target, e), e);
      if (at === null) {
        return;
      }
      h.at = at;
      h.loop = loop(m, at, e, landing);
    }, WAIT_DELAY_MS);
    hold = h;
  };
  /** Ends the hold; true when it was shown (its `waited` then settles where it played). */
  const endHold = (): boolean => {
    const h = hold;
    hold = null;
    if (h === null) {
      return false;
    }
    if (h.timer !== null) {
      clearTimeout(h.timer);
      return false;
    }
    stop(h.loop);
    return true;
  };

  return {
    capture(e) {
      if (e.cue.kind === 'ui-state' && e.cue.name === 'waited') {
        // The element (or box) its own hold played on, with its box now: a notice the flush removes settles on its ghost.
        const at = hold !== null && hold.timer === null ? hold.at : null;
        const caught = at === null || at.el === null ? at : { el: at.el, box: deps.boxOf(at.el) };
        return { e, caught: [caught] };
      }
      return { e, caught: motionsOf(e).map((m) => (isEmit(m) ? locate(m.target, e) : null)) };
    },
    run(plan) {
      if (disposed) {
        return;
      }
      const { e } = plan;
      const key = cueKey(e.cue);
      // A settling key ends its puzzle's loop where it stands, in the step that starts its own first motion.
      if (e.cue.kind === 'puzzle') {
        const running = loops.get(e.cue.puzzle);
        if (running !== undefined && running.until.includes(key)) {
          loops.delete(e.cue.puzzle);
          stop(running.loop);
        }
      }
      if (e.cue.kind === 'ui-state' && e.cue.name === 'waiting') {
        startHold(e);
        return;
      }
      if (e.cue.kind === 'ui-state' && e.cue.name === 'waited') {
        // Caught at the emit; a hold shown between the emit and this run settles where it plays.
        const at = found(plan.caught[0] ?? NOTHING) ?? (hold !== null && hold.timer === null ? hold.at : null);
        if (endHold() && at !== null) {
          play(motionOf(e.cue), at, e, true);
        }
        return;
      }
      const first = motionOf(e.cue);
      const motions = motionsOf(e);
      let played = 0;
      let fellBack = false;
      motions.forEach((m, i) => {
        const c = plan.caught[i] ?? locate(m.target, e);
        if (i === 0) {
          const before = counted;
          const { at, landing } = firstAt(c, e);
          fellBack = counted !== before;
          if (at === null) {
            return;
          }
          if (first.until !== undefined && e.cue.kind === 'puzzle') {
            const l = loop(m, at, e, landing);
            if (l !== null) {
              stop(loops.get(e.cue.puzzle)?.loop ?? null);
              loops.set(e.cue.puzzle, { loop: l, until: first.until });
              played += 1;
            }
            return;
          }
          played += play(m, at, e, landing) ? 1 : 0;
          return;
        }
        // A `with` motion whose target does not resolve is skipped; the first motion keeps the cue visible.
        const at = found(c);
        if (at !== null && play(m, at, e, false)) {
          played += 1;
        }
      });
      if (played === 0 && !fellBack) {
        counted += 1;
      }
      if (first.haptic !== null) {
        deps.haptic(first.haptic);
      }
    },
    fallbacks() {
      return counted;
    },
    dispose() {
      disposed = true;
      endHold();
      for (const { loop: l } of loops.values()) {
        stop(l);
      }
      loops.clear();
      for (const r of [...runs]) {
        cancel(r);
      }
      observer?.disconnect();
      observer = null;
    },
  };
}
