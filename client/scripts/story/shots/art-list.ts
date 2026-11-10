// The art list (docs/plans/shots §3.5, §6.5-6.6, lane SH2): what the owner draws for one story, written on request by
// `npm run story -- --art-list` to target/art-list/<story>.md (owner-readable) and .json (the same data). Only what
// the ink uses: a face state exists only where the flow puts that character in that expression in that shot (every
// face member, any size, S30), talk mouths only where it speaks in that expression, an expression's own derived
// states only where it changes that box (listed as conditional: the asset tool reports which were needed). Back views
// carry no face states. The minutes are §6.5's default table (E), a range from every derived state reused (lower) to
// every one drawn (upper). Pure, no node:*.
import type { AssetCatalog } from '../../../src/story/catalog.ts';
import type { BgId, CamTarget, ChapterId, CharId, ExprId, LineId, Motion } from '../../../src/story/staging.ts';
import type { ChapterFlow } from './flow.ts';
import type { EffectiveShot, Frame, LocId, ShotList, View } from './list.ts';
import { encodeSorted } from './usage.ts';
import type { ChapterShots } from './usage.ts';

/** Where `--art-list` writes, repo-relative (git-ignored `target/`). */
export const ART_LIST_DIR = 'target/art-list';

/**
 * §6.5's default minutes (E): a shot with no cast (camera, renders, generation, upscale, plane masks, depth, ambient,
 * export); per cast member its inpaint (step 7); per face member its head mask (step 8); per face state (step 9).
 */
export const MINUTES = { shot: 92, member: 9, face: 1, state: 4 } as const;
/** A further non-rest expression of one face in one shot: itself, plus 0-5 derived states (§6.5, +4-24 min). */
export const MARGINAL = { lower: MINUTES.state, upper: 6 * MINUTES.state } as const;

/** A face state to draw; `conditional`: only if its expression changes that box, else the rest state is reused. */
export type ArtState = { readonly state: string; readonly conditional: boolean };
/** An expression a face member is needed in: whether it speaks in it, the lines, and (not at rest) its states. */
export type ArtExpr = { readonly expr: ExprId; readonly talk: boolean; readonly lines: readonly LineId[]; readonly states: readonly ArtState[] };
/** A mask to cut (§6.5 step 8): `typical` = a second hair lock, drawn when the hair needs it. */
export type ArtMask = { readonly mask: string; readonly typical: boolean };
export type ArtMember = {
  readonly char: CharId;
  readonly view: View;
  readonly rest: ExprId;
  readonly figure: boolean;
  readonly masks: readonly ArtMask[];
  /** The rest expression's own states (a face view): half, closed, accent; talk1, talk2 when it speaks at rest. */
  readonly restSet: readonly string[];
  readonly needs: readonly ArtExpr[];
};
export type Range = { readonly lower: number; readonly upper: number };
export type ArtShot = {
  readonly id: BgId;
  readonly loc: LocId;
  readonly frame: Frame;
  /** Declared in story/shots.json (else an implied cast-less shot: to stage). */
  readonly declared: boolean;
  /** The catalog has art for it (else an implied placeholder: to draw). */
  readonly drawn: boolean;
  readonly chapters: readonly ChapterId[];
  /** The presented steps it may be on stage at (the reuse table). */
  readonly steps: number;
  readonly cast: readonly ArtMember[];
  readonly camTargets: readonly CamTarget[];
  readonly motions: readonly Motion[];
  /** Per shot file, its tier by the per-file rule (§2.5): public when a free chapter lists it, else gated. */
  readonly files: readonly { readonly id: string; readonly tier: 'public' | 'gated' }[];
  readonly states: Range;
  readonly minutes: Range;
};
export type ArtChapter = {
  readonly id: ChapterId;
  readonly paid: boolean;
  readonly shots: number;
  /** Shots first used in this chapter: the chapter's share of the work. */
  readonly fresh: readonly BgId[];
  readonly minutes: Range;
  /** (shot, face, expression) uses beyond the first non-rest expression per face and shot, and their marginal minutes. */
  readonly extra: number;
  readonly marginal: Range;
};
export type ArtList = {
  readonly story: string;
  readonly locs: readonly { readonly id: LocId; readonly light: string | null; readonly shots: readonly BgId[] }[];
  readonly shots: readonly ArtShot[];
  readonly toDraw: readonly BgId[];
  readonly toStage: readonly BgId[];
  readonly chapters: readonly ArtChapter[];
  readonly total: { readonly shots: number; readonly states: Range; readonly minutes: Range };
};
/** One chapter of the story, in story order. */
export type ArtChapterInput = { readonly id: ChapterId; readonly paid: boolean; readonly flow: ChapterFlow; readonly usage: ChapterShots };
export type ArtInput = {
  readonly story: string;
  readonly chapters: readonly ArtChapterInput[];
  readonly list: ShotList;
  readonly shots: ReadonlyMap<BgId, EffectiveShot>;
  /** The committed catalog (not the effective one): which shots have art. */
  readonly catalog: AssetCatalog;
};

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sum = (rs: readonly Range[]): Range => ({ lower: rs.reduce((n, r) => n + r.lower, 0), upper: rs.reduce((n, r) => n + r.upper, 0) });

/** A non-rest expression's states (§3.5): itself, then its blink pair, accent and (where it speaks in it) talk pair. */
function exprStates(x: ExprId, talk: boolean): ArtState[] {
  const derived = ['half', 'closed', 'accent', ...(talk ? ['talk1', 'talk2'] : [])];
  return [{ state: x, conditional: false }, ...derived.map((d) => ({ state: `${x}.${d}`, conditional: true }))];
}

function member(m: EffectiveShot['cast'][number], needs: ReadonlyMap<ExprId, { talk: boolean; lines: LineId[] }>): ArtMember {
  const face = m.view === 'face';
  const exprs = [...needs].sort(([a], [b]) => order(a, b));
  const speaksAtRest = needs.get(m.rest)?.talk ?? false;
  return {
    char: m.char,
    view: m.view,
    rest: m.rest,
    figure: m.figure,
    masks: [
      { mask: 'mask.fig', typical: false },
      ...(face ? [{ mask: 'mask.head', typical: false }] : []),
      { mask: 'hair.1', typical: false },
      { mask: 'hair.2', typical: true },
    ],
    restSet: face ? ['half', 'closed', 'accent', ...(speaksAtRest ? ['talk1', 'talk2'] : [])] : [],
    needs: face ? exprs.map(([expr, n]) => ({ expr, talk: n.talk, lines: n.lines, states: expr === m.rest ? [] : exprStates(expr, n.talk) })) : [],
  };
}

/** A member's face states: the rest set, then per non-rest expression itself (lower) or all its states (upper). */
function statesOf(m: ArtMember): Range {
  const others = m.needs.filter((n) => n.expr !== m.rest);
  return { lower: m.restSet.length + others.length, upper: m.restSet.length + others.reduce((n, x) => n + x.states.length, 0) };
}

/** The art list of one story (§3.5). */
export function artList(input: ArtInput): ArtList {
  type Acc = { chapters: ChapterId[]; steps: number; first: [number, string, number]; needs: Map<CharId, Map<ExprId, { talk: boolean; lines: LineId[] }>>; cams: Set<CamTarget>; motions: Set<Motion>; free: Set<string>; all: Set<string> };
  const acc = new Map<BgId, Acc>();
  input.chapters.forEach((ch, ci) => {
    for (const [key, need] of Object.entries(ch.usage.shots)) {
      const s = key as BgId; // a decoded shot id
      const a: Acc = acc.get(s) ?? { chapters: [], steps: 0, first: [Number.POSITIVE_INFINITY, '', 0], needs: new Map(), cams: new Set(), motions: new Set(), free: new Set(), all: new Set() };
      a.chapters.push(ch.id);
      for (const [c, list] of Object.entries(need.faces)) {
        const by = a.needs.get(c as CharId) ?? new Map<ExprId, { talk: boolean; lines: LineId[] }>(); // a decoded cast member
        for (const f of list) {
          const n = by.get(f.expr) ?? { talk: false, lines: [] };
          by.set(f.expr, { talk: n.talk || f.talk, lines: [...n.lines, ...f.lines] });
        }
        a.needs.set(c as CharId, by);
      }
      for (const t of need.camTargets) {
        a.cams.add(t);
      }
      for (const m of need.motions) {
        a.motions.add(m);
      }
      for (const id of ch.usage.assets.filter((x) => x === `bg/${s}` || x === `sheet/${s}` || x.startsWith(`face/${s}/`) || x.startsWith(`talk/${s}/`))) {
        a.all.add(id);
        if (!ch.paid) {
          a.free.add(id);
        }
      }
      for (const step of ch.flow.steps.values()) {
        if (!step.effect.shots.has(s)) {
          continue;
        }
        a.steps += step.key.startsWith('k:') ? 0 : 1;
        const at: [number, string, number] = [ci, step.file, step.line];
        if (at[0] < a.first[0] || (at[0] === a.first[0] && (at[1] < a.first[1] || (at[1] === a.first[1] && at[2] < a.first[2])))) {
          a.first = at;
        }
      }
      acc.set(s, a);
    }
  });
  const used = [...acc.keys()].sort((x, y) => {
    const a = acc.get(x)?.first ?? [0, '', 0];
    const b = acc.get(y)?.first ?? [0, '', 0];
    return a[0] - b[0] || order(a[1], b[1]) || a[2] - b[2] || order(x, y);
  });
  const shots: ArtShot[] = [];
  for (const s of used) {
    const shot = input.shots.get(s);
    const a = acc.get(s);
    if (shot === undefined || a === undefined) {
      continue; // every used shot is an effective one (usage.ts skips the rest)
    }
    const cast = shot.cast.map((m) => member(m, a.needs.get(m.char) ?? new Map()));
    const states = sum(cast.map(statesOf));
    const fixed = MINUTES.shot + MINUTES.member * cast.length + MINUTES.face * cast.filter((m) => m.view === 'face').length;
    shots.push({
      id: s,
      loc: shot.loc,
      frame: shot.frame,
      declared: shot.declared,
      drawn: Object.hasOwn(input.catalog.bg, s),
      chapters: a.chapters,
      steps: a.steps,
      cast,
      camTargets: [...a.cams].sort(order),
      motions: [...a.motions].sort(order),
      files: [...a.all].sort(order).map((id) => ({ id, tier: a.free.has(id) ? 'public' : 'gated' })),
      states,
      minutes: { lower: fixed + MINUTES.state * states.lower, upper: fixed + MINUTES.state * states.upper },
    });
  }
  const lights = new Map(input.list.locs.map((l) => [l.id, l.light]));
  const locs: Array<{ id: LocId; light: string | null; shots: BgId[] }> = [];
  for (const s of shots) {
    const loc = locs.find((l) => l.id === s.loc);
    if (loc === undefined) {
      locs.push({ id: s.loc, light: lights.get(s.loc) ?? null, shots: [s.id] }); // locations in order of first use
    } else {
      loc.shots.push(s.id);
    }
  }
  const chapters = input.chapters.map((ch): ArtChapter => {
    const fresh = shots.filter((s) => s.chapters[0] === ch.id);
    let extra = 0;
    for (const [key, need] of Object.entries(ch.usage.shots)) {
      const cast = input.shots.get(key as BgId)?.cast ?? []; // a decoded shot id
      for (const [c, list] of Object.entries(need.faces)) {
        const rest = cast.find((m) => m.char === c)?.rest;
        extra += Math.max(0, list.filter((f) => f.expr !== rest).length - 1);
      }
    }
    return {
      id: ch.id,
      paid: ch.paid,
      shots: Object.keys(ch.usage.shots).length,
      fresh: fresh.map((s) => s.id),
      minutes: sum(fresh.map((s) => s.minutes)),
      extra,
      marginal: { lower: extra * MARGINAL.lower, upper: extra * MARGINAL.upper },
    };
  });
  return {
    story: input.story,
    locs,
    shots,
    toDraw: shots.filter((s) => !s.drawn).map((s) => s.id),
    toStage: shots.filter((s) => !s.declared).map((s) => s.id),
    chapters,
    total: { shots: shots.length, states: sum(shots.map((s) => s.states)), minutes: sum(shots.map((s) => s.minutes)) },
  };
}

/** The json file: the art list with sorted keys. */
export function encodeArtList(a: ArtList): string {
  return encodeSorted(a);
}

const hours = (r: Range): string => `${r.lower}-${r.upper} min (${(r.lower / 60).toFixed(1)}-${(r.upper / 60).toFixed(1)} h)`;
const code = (s: string): string => `\`${s}\``;

function memberLines(m: ArtMember): string[] {
  const out = [`  - ${code(m.char)}: ${m.view} view, rest ${code(m.rest)}${m.figure ? ', figure plane' : ''}`];
  out.push(`    - masks: ${m.masks.map((x) => (x.typical ? `${x.mask} (typical)` : x.mask)).join(', ')}`);
  if (m.view === 'back') {
    out.push('    - no face states (no face is visible)');
    return out;
  }
  out.push(`    - rest set: ${m.restSet.join(', ')}`);
  for (const n of m.needs) {
    const lines = `${n.lines.length} line${n.lines.length === 1 ? '' : 's'}: ${n.lines.join(', ')}`;
    const said = n.talk ? '; speaks' : '';
    if (n.states.length === 0) {
      out.push(`    - ${code(n.expr)} (rest; ${lines}${said})`);
      continue;
    }
    const derived = n.states.filter((x) => x.conditional).map((x) => x.state);
    out.push(`    - ${code(n.expr)} (${lines}${said}): ${n.expr}; then ${derived.join(', ')}: each only if ${n.expr} changes that box; else the rest state is reused`);
  }
  return out;
}

/** The md file (§3.5): to draw, to stage, per location its light and setups, the chapter totals and the reuse table. */
export function artListMarkdown(a: ArtList): string {
  const out = [`# Art list: ${a.story}`, ''];
  out.push(
    `Minutes are the shots plan's §6.5 defaults (an estimate): ${MINUTES.shot} per shot, +${MINUTES.member} per cast member, +${MINUTES.face} per face, +${MINUTES.state} per face state; lower = every derived state reused, upper = every one drawn.`,
    '',
  );
  out.push('## To draw', '');
  out.push(...(a.toDraw.length === 0 ? ['None.'] : a.toDraw.map((s) => `- ${code(s)}: no catalog art (an implied placeholder)`)), '');
  out.push('## To stage', '');
  out.push(...(a.toStage.length === 0 ? ['None.'] : a.toStage.map((s) => `- ${code(s)} (${a.shots.find((x) => x.id === s)?.frame ?? 'wide'}): not in story/shots.json (an implied cast-less shot)`)), '');
  for (const loc of a.locs) {
    out.push(`## Location ${code(loc.id)}`, '', `Light: ${loc.light ?? 'not written'}`, '');
    for (const s of a.shots.filter((x) => loc.shots.includes(x.id))) {
      out.push(`### Shot ${code(s.id)}`, '');
      out.push(`- ${s.frame}; chapters ${s.chapters.join(', ')}; on stage at ${s.steps} steps`);
      out.push(`- files: ${s.files.map((f) => `${f.id} (${f.tier})`).join(', ')}`);
      if (s.cast.length === 0) {
        out.push('- no cast');
      } else {
        out.push('- cast, back to front:', ...s.cast.flatMap(memberLines));
      }
      if (s.camTargets.length > 0) {
        out.push(`- camera targets (stay sharp at <= 130 %): ${s.camTargets.join(', ')}`);
      }
      if (s.motions.length > 0) {
        out.push(`- motions: ${s.motions.join(', ')}${s.motions.some((m) => m === 'hop' || m === 'bounce') ? ' (hop / bounce need a figure plane)' : ''}`);
      }
      out.push(`- face states ${s.states.lower}-${s.states.upper}; estimate ${hours(s.minutes)}`, '');
    }
  }
  out.push('## Chapters', '', '| Chapter | Tier | Shots | New shots | Estimate (new shots) | Extra expressions |', '|---|---|---|---|---|---|');
  for (const ch of a.chapters) {
    out.push(`| ${ch.id} | ${ch.paid ? 'paid' : 'free'} | ${ch.shots} | ${ch.fresh.length} | ${hours(ch.minutes)} | ${ch.extra} (+${hours(ch.marginal)}) |`);
  }
  out.push('', `Total: ${a.total.shots} shots, face states ${a.total.states.lower}-${a.total.states.upper}, ${hours(a.total.minutes)}.`, '');
  out.push('## Reuse', '', '| Shot | Steps |', '|---|---|');
  for (const s of [...a.shots].sort((x, y) => y.steps - x.steps || order(x.id, y.id))) {
    out.push(`| ${code(s.id)} | ${s.steps} |`);
  }
  return `${out.join('\n')}\n`;
}
