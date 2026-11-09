// The shot lints (docs/plans/shots §3.3, lane SH2; STAGING-DSL §14): their own registry beside the DSL's LINT_CODES
// (engine plan §3.2: each lint file declares its own codes), so `lint.ts`, its closed `Finding` union and the §11 doc
// pin stay untouched. `story.ts` reports `Finding | ShotFinding`. Pure, no node:*.
import type { Severity } from '../lint.ts';

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
} as const satisfies Readonly<Record<string, Severity>>;
export type ShotLintCode = keyof typeof SHOT_LINT_CODES;

/** A shot finding: `file` repo-relative or story-relative as its producer says; `line` 1-based, 0 = the whole file. */
export type ShotFinding = { code: ShotLintCode; severity: Severity; file: string; line: number; message: string };

export function shotFinding(code: ShotLintCode, file: string, line: number, message: string): ShotFinding {
  return { code, severity: SHOT_LINT_CODES[code], file, line, message };
}
