// The `setting` device (engine plan §7.2, §7.5; GM8a D3, D6, D10): `parts` knobs of `positions` positions, every one at
// 0 at the start; a turn moves one knob one position on, wrapping at `positions`, and the pull (its own part, `pull`)
// posts the configuration. The data half (engine plan §7.1): a commit type in its room's view whose secret goal the
// server checks; any configuration the knobs hold is a saved work that fits (every one is reachable by turns).
import type { Result } from '../../story/catalog.ts';
import type { Rect } from '../../story/staging.ts';
import type { PuzzleTypeData } from './index.ts';
import { count, fitsConfiguration, keyed, rect, rectList, zeros } from './levers.ts';

export type SettingParams = {
  readonly parts: number;
  readonly positions: number;
  /** Per knob, its part's rect in room source px. */
  readonly rects: readonly Rect[];
  /** The pull's rect: the device's commit part, no knob. */
  readonly pull: Rect;
};

const KEYS: readonly string[] = ['parts', 'positions', 'rects', 'pull'];

function decodeParams(raw: unknown): Result<SettingParams, string> {
  const r = keyed(raw, 'setting', KEYS);
  if (!r.ok) {
    return r;
  }
  const parts = count('parts', r.value.parts, 1, 8);
  if (!parts.ok) {
    return parts;
  }
  const positions = count('positions', r.value.positions, 2, 10);
  if (!positions.ok) {
    return positions;
  }
  const rects = rectList(r.value.rects, parts.value);
  if (!rects.ok) {
    return rects;
  }
  const pull = rect('pull', r.value.pull);
  if (!pull.ok) {
    return pull;
  }
  return { ok: true, value: { parts: parts.value, positions: positions.value, rects: rects.value, pull: pull.value } };
}

export const SETTING_RULES = Object.freeze({
  type: 'setting',
  check: 'commit',
  goal: 'secret',
  presentation: 'view',
  wrong: 'posted',
  // The pull posts the working configuration, as Try does.
  commit: 'control',
  decodeParams,
  answerShape: (p: SettingParams): { len: number; max: number } => ({ len: p.parts, max: p.positions - 1 }),
  initial: zeros,
  // The knobs show their zeros before any input.
  startShown: zeros,
  workFits: (p: SettingParams, work: readonly number[]): boolean => fitsConfiguration(work, p.parts, p.positions),
  controls: [
    { name: 'setting-part', on: 'click' },
    { name: 'setting-pull', on: 'click' },
  ],
} as const satisfies PuzzleTypeData<'setting', SettingParams>);
