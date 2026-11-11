// The shot lints (docs/plans/shots §3.3, lane SH2; STAGING-DSL §14): their own registry beside the DSL's LINT_CODES
// (engine plan §3.2: each lint file declares its own codes), so `lint.ts`, its closed `Finding` union and the §11 doc
// pin stay untouched. `story.ts` reports `Finding | ShotFinding`. Legacy sprites are read only through
// `Effect.sprites` (rev. 5, W3). Pure, no node:*.
import type { AssetCatalog } from '../../../src/story/catalog.ts';
import type { BgId, ChapterId, CharId, ExprId, LineId, Rect, StagingCommand } from '../../../src/story/staging.ts';
import type { WorldPublicBody } from '../../../src/world/types.ts';
import type { Severity } from '../lint.ts';
import type { Batch, ChapterFlow, Effect, Placed, StepFlow } from './flow.ts';
import { SHOTS_FILE } from './list.ts';
import type { EffectiveShot } from './list.ts';

/** Every §14 code with its severity, exactly as the doc's table (shots.test.ts holds the two in step). */
export const SHOT_LINT_CODES = {
  'shot/undeclared': 'W',
  'shot/room-frame': 'E',
  'shot/list': 'E',
  'shot/char-absent': 'E',
  'shot/back-view': 'E',
  'shot/motion-unsupported': 'E',
  'shot/sprite-in-shot-chapter': 'E',
  'shot/loc-change': 'W',
  'shot/plane-over-hotspot': 'W',
  'shot/implied-placeholder': 'W',
  'art/pending': 'W',
  'flow/edge-missing': 'E',
  'flow/unsupported': 'E',
  // Enforced by the build's budget gate (budget.ts), which has the decoded sizes; `story` never reports them.
  'budget/step-window': 'E',
  'budget/entry-step': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
export type ShotLintCode = keyof typeof SHOT_LINT_CODES;

/** A shot finding: `file` repo-relative or story-relative as its producer says; `line` 1-based, 0 = the whole file. */
export type ShotFinding = { code: ShotLintCode; severity: Severity; file: string; line: number; message: string };

export function shotFinding(code: ShotLintCode, file: string, line: number, message: string): ShotFinding {
  return { code, severity: SHOT_LINT_CODES[code], file, line, message };
}

/** A plane of a shot's sheet: its box in plate px and whether it draws above the props (§2.1). */
export type Plane = { readonly at: Rect; readonly front: boolean };
/** One listed chapter as the shot lints see it; `world` is its public world (none: null). */
export type ShotChapter = { readonly id: ChapterId; readonly flow: ChapterFlow; readonly world: WorldPublicBody | null };
export type ShotLintInput = {
  /** Every compiled listed chapter, in list order. */
  readonly chapters: readonly ShotChapter[];
  /** The effective shots (`effectiveShots`). */
  readonly shots: ReadonlyMap<BgId, EffectiveShot>;
  /** The catalog before `effectiveCatalog`: a used shot it lacks is an implied placeholder; a placeholder bg has no art. */
  readonly catalog: AssetCatalog;
  /** Per shot, its planes (none on this tree: no shot has sources yet, cut D8). */
  readonly planes: ReadonlyMap<BgId, readonly Plane[]>;
};

/** A face state a chapter needs: (shot, character, expression), whether the character speaks in it, and the lines. */
export type FaceNeed = { readonly shot: BgId; readonly char: CharId; readonly expr: ExprId; readonly talk: boolean; readonly lines: readonly LineId[] };

/** The character a `face:`, an `anim:` or a `cam:` with a character target names, else null. */
function castNamed(c: StagingCommand): CharId | null {
  if (c.kind === 'face' || c.kind === 'anim') {
    return c.char;
  }
  if (c.kind === 'cam' && c.cam.kind !== 'pull' && c.cam.to !== 'center' && c.cam.to !== 'left' && c.cam.to !== 'right') {
    return c.cam.to;
  }
  return null;
}

function tagText(c: StagingCommand): string {
  if (c.kind === 'face') {
    return `face: ${c.char} ${c.expr}`;
  }
  if (c.kind === 'anim') {
    return `anim: ${c.char} ${c.motion}`;
  }
  return c.kind === 'cam' && c.cam.kind !== 'pull' ? `cam: ${c.cam.kind} to=${c.cam.to}` : c.kind;
}

/** A step is a line or a choice (its key a line ID), never a knot entry. */
function lineOf(step: StepFlow): LineId | null {
  return step.key.startsWith('k:') ? null : (step.key as LineId); // a line ID key
}

/**
 * Every face state a chapter's steps need (§3.5 "expressions needed per character"): at each step, each shot of its
 * batch's may-set, each `face` member of that shot in each expression in effect (a face no `face:` set since the
 * scene is at its rest in that shot); `talk` when it speaks there (the step's speaker, not `think`). Sorted by shot,
 * character, expression; lines in step order.
 */
export function faceNeeds(flow: ChapterFlow, shots: ReadonlyMap<BgId, EffectiveShot>): FaceNeed[] {
  const out = new Map<string, { shot: BgId; char: CharId; expr: ExprId; talk: boolean; lines: Set<LineId> }>();
  for (const step of flow.steps.values()) {
    const line = lineOf(step);
    for (const b of step.batches) {
      for (const s of b.effect.shots) {
        for (const m of shots.get(s)?.cast ?? []) {
          if (m.view !== 'face') {
            continue;
          }
          for (const x of b.effect.faces.get(m.char) ?? [null]) {
            const expr = x ?? m.rest;
            const key = `${s}/${m.char}/${expr}`;
            const need = out.get(key) ?? { shot: s, char: m.char, expr, talk: false, lines: new Set<LineId>() };
            need.talk ||= step.speaker === m.char && !step.think;
            if (line !== null) {
              need.lines.add(line);
            }
            out.set(key, need);
          }
        }
      }
    }
  }
  return [...out.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, n]) => ({ shot: n.shot, char: n.char, expr: n.expr, talk: n.talk, lines: [...n.lines] }));
}

/** The shots a chapter uses: named by a `bg:` / `scene:` of its batches or by a room of its world (§3.3). */
export function usedShots(flow: ChapterFlow, world: WorldPublicBody | null): Set<BgId> {
  const out = new Set<BgId>();
  for (const step of flow.steps.values()) {
    for (const b of step.batches) {
      for (const p of b.commands) {
        if (p.cmd.kind === 'bg' || p.cmd.kind === 'scene') {
          out.add(p.cmd.bg);
        }
      }
    }
  }
  for (const s of Object.values(world?.sections ?? {})) {
    for (const r of Object.values(s.rooms)) {
      out.add(r.bg);
    }
  }
  return out;
}

/** A shot chapter: it shows a shot with a cast (§3.3 `shot/sprite-in-shot-chapter`); else a legacy chapter. */
function castShotOf(flow: ChapterFlow, shots: ReadonlyMap<BgId, EffectiveShot>): BgId | null {
  for (const step of flow.steps.values()) {
    for (const s of step.effect.shots) {
      if ((shots.get(s)?.cast.length ?? 0) > 0) {
        return s;
      }
    }
  }
  return null;
}

/** The shots and the sprites before a batch: its predecessors' (none for a seeded entry: the empty stage). */
function before(flow: ChapterFlow, b: Batch): { shots: ReadonlySet<BgId>; sprites: string } {
  const prior: Effect[] = b.from.flatMap((f) => flow.steps.get(f)?.effect ?? []);
  const sprites = new Map<string, Set<string>>();
  for (const e of prior) {
    for (const [c, xs] of e.sprites) {
      sprites.set(c, new Set([...(sprites.get(c) ?? []), ...xs]));
    }
  }
  return { shots: new Set(prior.flatMap((e) => [...e.shots])), sprites: spriteKey(sprites) };
}

function spriteKey(sprites: ReadonlyMap<string, ReadonlySet<string>>): string {
  return JSON.stringify([...sprites].map(([k, v]) => [k, [...v].sort()]).sort());
}

function overlaps(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/** The cast rules of one batch's commands against the shots in effect after it (§3.3; D4: on some path). */
function castRules(b: Batch, shots: ReadonlyMap<BgId, EffectiveShot>, report: (p: Placed, code: 'shot/char-absent' | 'shot/back-view' | 'shot/motion-unsupported', shot: BgId | null) => void): void {
  for (const p of b.commands) {
    const char = castNamed(p.cmd);
    if (char === null) {
      continue;
    }
    if (b.effect.shots.size === 0) {
      report(p, 'shot/char-absent', null); // no shot on any path: a face before any bg / scene (§2.2)
    }
    for (const s of [...b.effect.shots].sort()) {
      const m = shots.get(s)?.cast.find((x) => x.char === char);
      if (m === undefined) {
        report(p, 'shot/char-absent', s);
      } else if (m.view === 'back' && p.cmd.kind !== 'anim') {
        report(p, 'shot/back-view', s);
      } else if (p.cmd.kind === 'anim' && (p.cmd.motion === 'hop' || p.cmd.motion === 'bounce') && !m.figure) {
        report(p, 'shot/motion-unsupported', s);
      }
    }
  }
}

/**
 * The shot lints of §3.3 over every listed chapter's flow, world and the effective shots: `shot/undeclared` and
 * `shot/implied-placeholder` once per shot (story/shots.json, naming the chapters that use it), `shot/room-frame` and
 * `shot/plane-over-hotspot` per world room, `shot/char-absent`, `shot/back-view`, `shot/motion-unsupported` per tag
 * (against the shots in effect after its batch, on some path), `shot/sprite-in-shot-chapter` per step whose batch
 * changes the sprites in a shot chapter, `shot/loc-change` per cut, `art/pending` per needed face state of a
 * placeholder shot. Findings name repo-relative files; sorted by file, line, code, message.
 */
export function lintShots(input: ShotLintInput): ShotFinding[] {
  const out: ShotFinding[] = [];
  const once = new Set<string>();
  const add = (f: ShotFinding): void => {
    const key = JSON.stringify(f);
    if (!once.has(key)) {
      once.add(key);
      out.push(f);
    }
  };
  const users = new Map<BgId, ChapterId[]>();
  for (const ch of input.chapters) {
    for (const s of usedShots(ch.flow, ch.world)) {
      users.set(s, [...(users.get(s) ?? []), ch.id]);
    }
  }
  for (const [s, chapters] of [...users].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const shot = input.shots.get(s);
    if (shot !== undefined && !shot.declared) {
      add(shotFinding('shot/undeclared', SHOTS_FILE, 0, `shot '${s}' (used by ${chapters.join(', ')}) is not declared: an implied cast-less shot, frame ${shot.frame} (§14)`));
    }
    if (shot?.declared === true && !Object.hasOwn(input.catalog.bg, s)) {
      add(shotFinding('shot/implied-placeholder', SHOTS_FILE, 0, `shot '${s}' (used by ${chapters.join(', ')}) has no assets/catalog.json entry: an implied placeholder, art pending (§14)`));
    }
  }
  for (const ch of input.chapters) {
    const worldFile = `story/${ch.id}/world.json`;
    for (const [sid, section] of Object.entries(ch.world?.sections ?? {})) {
      for (const [rid, room] of Object.entries(section.rooms)) {
        const shot = input.shots.get(room.bg);
        if (shot !== undefined && shot.frame !== 'room') {
          add(shotFinding('shot/room-frame', worldFile, 0, `room ${sid}.${rid} draws '${room.bg}', which story/shots.json declares frame ${shot.frame}: a room's shot is frame room (§14)`));
        }
        for (const plane of (input.planes.get(room.bg) ?? []).filter((p) => p.front)) {
          for (const h of room.hotspots.filter((x) => overlaps(plane.at, x.rect))) {
            add(shotFinding('shot/plane-over-hotspot', worldFile, 0, `a front plane of '${room.bg}' at [${plane.at.join(', ')}] covers hotspot ${sid}.${rid}.${h.id} (§14)`));
          }
        }
      }
    }
    const castShot = castShotOf(ch.flow, input.shots);
    for (const step of ch.flow.steps.values()) {
      for (const b of step.batches) {
        castRules(b, input.shots, (p, code, s) => {
          const char = castNamed(p.cmd) ?? '';
          const why =
            s === null
              ? `no shot is in effect on any path, so ${char} is in no cast`
              : code === 'shot/char-absent'
                ? `${char} is not in the cast of shot '${s}' (on some path)`
                : code === 'shot/back-view'
                  ? `${char} is a back view in shot '${s}'`
                  : `${char} has no figure plane in shot '${s}' (figure: true)`;
          add(shotFinding(code, `story/${p.file}`, p.line, `'${tagText(p.cmd)}': ${why} (§14)`));
        });
        const prior = before(ch.flow, b);
        if (castShot !== null && prior.sprites !== spriteKey(b.effect.sprites)) {
          add(shotFinding('shot/sprite-in-shot-chapter', `story/${step.file}`, step.line, `${ch.id} shows shot '${castShot}', which has a cast: a shot chapter has no sprites (§14)`));
        }
        const cut = b.commands.find((p) => p.cmd.kind === 'bg');
        const scene = b.commands.some((p) => p.cmd.kind === 'scene');
        if (cut?.cmd.kind === 'bg' && !scene) {
          const to = input.shots.get(cut.cmd.bg)?.loc;
          for (const s of [...prior.shots].sort()) {
            const from = input.shots.get(s)?.loc;
            if (from !== undefined && to !== undefined && from !== to) {
              add(shotFinding('shot/loc-change', `story/${cut.file}`, cut.line, `'bg: ${cut.cmd.bg}' cuts from location ${from} ('${s}') to ${to} without a scene (§14)`));
            }
          }
        }
      }
    }
    for (const need of faceNeeds(ch.flow, input.shots)) {
      const entry = Object.hasOwn(input.catalog.bg, need.shot) ? input.catalog.bg[need.shot] : undefined;
      if (entry === undefined || 'placeholder' in entry) {
        const first = need.lines[0];
        const step = first === undefined ? undefined : ch.flow.steps.get(first);
        const by = need.lines.length > 0 ? need.lines.join(', ') : 'a knot entry';
        add(shotFinding('art/pending', step === undefined ? SHOTS_FILE : `story/${step.file}`, step?.line ?? 0, `shot ${need.shot} lacks ${need.char}.${need.expr} (needed by ${by}) (§14)`));
      }
    }
  }
  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => order(a.file, b.file) || a.line - b.line || order(a.code, b.code) || order(a.message, b.message));
}
