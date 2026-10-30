// The only tag parser (docs/STAGING-DSL.md §2, §4-§7): the story gate and the runtime both call `parseTags`, so a
// tag the gate accepts is exactly a tag the runtime can execute. Pure, no I/O; it never throws on any input.
import type {
  AssetIndex,
  BgId,
  CgId,
  CharId,
  ExprId,
  LineId,
  ParsedTags,
  SfxId,
  Slot,
  StagingCommand,
  TagError,
  TrackId,
} from './staging.ts';

/** Every tag kind of STAGING-DSL §6, in table order: `id` is the line ID, the rest are the command kinds. */
export const TAG_KINDS = ['id', 'bg', 'scene', 'show', 'hide', 'cg', 'bgm', 'sfx', 'wait'] as const;
export type TagKind = (typeof TAG_KINDS)[number];

type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? A : never) : never;
/** `never` when TAG_KINDS and StagingCommand['kind'] drift apart, which fails `check` at every `case` below. */
type CommandKind = SameUnion<Exclude<TagKind, 'id'>, StagingCommand['kind']>;

/** STAGING-DSL §4, exact. */
export const LINE_ID_RE = /^ch[1-9][0-9]*\.[a-z][a-z0-9_]*\.[0-9a-z]{4}$/;
/** STAGING-DSL §5, exact: the speaker prefix of a text line. */
export const SPEAKER_RE = /^([a-z][a-z0-9_]*): (.+)$/;

// §2: tag = kind [ ws? ":" ws? args ]; ws is spaces or tabs only.
const TAG_RE = /^([a-z][a-z0-9_]*)(?:[ \t]*:[ \t]*(.*))?$/;
const POSITIONAL_RE = /^[a-z0-9][a-z0-9_]*$/;
const OPTION_RE = /^([a-z]+)=([a-z0-9_]+)$/;
const INTEGER_RE = /^[0-9]+$/;
const MS_MAX = 10000;

/**
 * Splits a text line into its speaker prefix and the displayed text (§5). The caller trims ink's trailing newline
 * first; whether the speaker is in the cast is the lint's check, not this one.
 */
export function splitSpeaker(text: string): { speaker: string | null; text: string } {
  const m = SPEAKER_RE.exec(text);
  const speaker = m?.[1];
  const rest = m?.[2];
  if (speaker === undefined || rest === undefined) {
    return { speaker: null, text };
  }
  return { speaker, text: rest };
}

/** The kind of a tag if its kind part is well-formed (§2), else null; known or not is `parseTags`' check. */
export function tagKind(tag: string): string | null {
  return TAG_RE.exec(tag.trim())?.[1] ?? null;
}

function isTagKind(kind: string): kind is TagKind {
  return (TAG_KINDS as readonly string[]).includes(kind);
}

type Options = ReadonlyMap<string, string>;
type Args = { positional: readonly string[]; options: Options };
type One = { kind: 'id'; id: LineId | null; error: TagError | null } | { kind: 'command'; command: StagingCommand };

function fail(tag: string, reason: TagError['reason'], detail: string): TagError {
  return { tag, reason, detail };
}

/**
 * Splits args into positionals and options and checks their shape: the grammar (§2), the positional count and the
 * option names. On success `positional.length === arity`, which is what makes the tuple casts in `command` exact.
 * `id` takes its one positional verbatim: it is checked against LINE_ID_RE (§4), not against §2's `positional`.
 */
function readArgs(
  tag: string,
  kind: TagKind,
  args: string | undefined,
  arity: number,
  optionNames: readonly string[],
): Args | TagError {
  const text = (args ?? '').trim();
  const count = `'${kind}' takes ${arity} argument${arity === 1 ? '' : 's'}`;
  if (text === '') {
    return fail(tag, 'missing-arg', count);
  }
  const positional: string[] = [];
  const pairs: Array<readonly [string, string]> = [];
  for (const token of text.split(/[ \t]+/)) {
    const option = OPTION_RE.exec(token);
    const name = option?.[1];
    const value = option?.[2];
    if (name !== undefined && value !== undefined) {
      pairs.push([name, value]);
    } else if (kind === 'id' || POSITIONAL_RE.test(token)) {
      positional.push(token);
    } else {
      return fail(tag, 'syntax', `'${token}' is neither an id nor an option name=value (lowercase, no spaces)`);
    }
  }
  if (positional.length < arity) {
    return fail(tag, 'missing-arg', `${count}, got ${positional.length}`);
  }
  if (positional.length > arity) {
    return fail(tag, 'bad-arg', `${count}, got ${positional.length}`);
  }
  const options = new Map<string, string>();
  for (const [name, value] of pairs) {
    if (!optionNames.includes(name)) {
      return fail(tag, 'bad-arg', `unknown option '${name}' for '${kind}'`);
    }
    if (options.has(name)) {
      return fail(tag, 'bad-arg', `duplicate option '${name}'`);
    }
    options.set(name, value);
  }
  return { positional, options };
}

function int(tag: string, name: string, value: string, min: number, max: number): number | TagError {
  if (!INTEGER_RE.test(value)) {
    return fail(tag, 'bad-arg', `${name}=${value} is not an integer`);
  }
  const n = Number(value);
  if (n < min || n > max) {
    return fail(tag, 'bad-arg', `${name}=${value} is out of range ${min}-${max}`);
  }
  return n;
}

function intOption(tag: string, options: Options, name: string, fallback: number, max: number): number | TagError {
  const value = options.get(name);
  return value === undefined ? fallback : int(tag, name, value, 0, max);
}

function choice<T extends string>(
  tag: string,
  options: Options,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T | TagError {
  const value = options.get(name);
  if (value === undefined) {
    return fallback;
  }
  const hit = allowed.find((a) => a === value);
  return hit ?? fail(tag, 'bad-arg', `${name}=${value} is not one of ${allowed.join(', ')}`);
}

function unknownAsset(tag: string, what: string): TagError {
  return fail(tag, 'unknown-asset', `${what} is not in assets/catalog.json`);
}

const SLOTS: readonly Slot[] = ['left', 'center', 'right'];
const FADE_CUT = ['fade', 'cut'] as const;

/**
 * One command tag after its kind is known: arg shape first, then values, then the catalog (§6, §8). Reserved words
 * are only valid in their own slot; elsewhere they are unknown assets, since the catalog never lists them.
 */
function command(tag: string, kind: CommandKind, rawArgs: string | undefined, assets: AssetIndex): One | TagError {
  switch (kind) {
    case 'bg': {
      const a = readArgs(tag, kind, rawArgs, 1, ['t', 'ms']);
      if ('reason' in a) return a;
      const t = choice(tag, a.options, 't', ['crossfade', 'fade', 'cut'] as const, 'crossfade');
      if (typeof t === 'object') return t;
      const ms = intOption(tag, a.options, 'ms', 500, MS_MAX);
      if (typeof ms === 'object') return ms;
      const [bg] = a.positional as [string];
      if (!assets.hasBg(bg)) return unknownAsset(tag, `bg '${bg}'`);
      return { kind: 'command', command: { kind, bg: bg as BgId, t, ms } };
    }
    case 'scene': {
      const a = readArgs(tag, kind, rawArgs, 1, ['t', 'ms']);
      if ('reason' in a) return a;
      const t = choice(tag, a.options, 't', FADE_CUT, 'fade');
      if (typeof t === 'object') return t;
      const ms = intOption(tag, a.options, 'ms', 800, MS_MAX);
      if (typeof ms === 'object') return ms;
      const [bg] = a.positional as [string];
      if (!assets.hasBg(bg)) return unknownAsset(tag, `bg '${bg}'`);
      return { kind: 'command', command: { kind, bg: bg as BgId, t, ms } };
    }
    case 'show': {
      const a = readArgs(tag, kind, rawArgs, 2, ['at', 't', 'ms']);
      if ('reason' in a) return a;
      const at = a.options.has('at') ? choice(tag, a.options, 'at', SLOTS, 'center') : null;
      if (typeof at === 'object' && at !== null) return at;
      const t = choice(tag, a.options, 't', FADE_CUT, 'fade');
      if (typeof t === 'object') return t;
      const ms = a.options.has('ms') ? intOption(tag, a.options, 'ms', 0, MS_MAX) : null;
      if (typeof ms === 'object' && ms !== null) return ms;
      const [char, expr] = a.positional as [string, string];
      if (!assets.hasChar(char)) return unknownAsset(tag, `character '${char}'`);
      if (!assets.hasExpr(char, expr)) return unknownAsset(tag, `expression '${expr}' of '${char}'`);
      return { kind: 'command', command: { kind, char: char as CharId, expr: expr as ExprId, at, t, ms } };
    }
    case 'hide': {
      const a = readArgs(tag, kind, rawArgs, 1, ['t', 'ms']);
      if ('reason' in a) return a;
      const t = choice(tag, a.options, 't', FADE_CUT, 'fade');
      if (typeof t === 'object') return t;
      const ms = intOption(tag, a.options, 'ms', 300, MS_MAX);
      if (typeof ms === 'object') return ms;
      const [char] = a.positional as [string];
      if (char !== 'all' && !assets.hasChar(char)) return unknownAsset(tag, `character '${char}'`);
      return { kind: 'command', command: { kind, char: char === 'all' ? 'all' : (char as CharId), t, ms } };
    }
    case 'cg': {
      const a = readArgs(tag, kind, rawArgs, 1, ['t', 'ms']);
      if ('reason' in a) return a;
      const t = choice(tag, a.options, 't', FADE_CUT, 'fade');
      if (typeof t === 'object') return t;
      const ms = intOption(tag, a.options, 'ms', 500, MS_MAX);
      if (typeof ms === 'object') return ms;
      const [cg] = a.positional as [string];
      if (cg !== 'off' && !assets.hasCg(cg)) return unknownAsset(tag, `cg '${cg}'`);
      return { kind: 'command', command: { kind, cg: cg === 'off' ? null : (cg as CgId), t, ms } };
    }
    case 'bgm': {
      const a = readArgs(tag, kind, rawArgs, 1, ['fade', 'vol']);
      if ('reason' in a) return a;
      const fadeMs = intOption(tag, a.options, 'fade', 1000, MS_MAX);
      if (typeof fadeMs === 'object') return fadeMs;
      const vol = intOption(tag, a.options, 'vol', 100, 100);
      if (typeof vol === 'object') return vol;
      const [track] = a.positional as [string];
      if (track !== 'stop' && !assets.hasTrack(track)) return unknownAsset(tag, `bgm '${track}'`);
      return { kind: 'command', command: { kind, track: track === 'stop' ? null : (track as TrackId), fadeMs, vol } };
    }
    case 'sfx': {
      const a = readArgs(tag, kind, rawArgs, 1, ['vol']);
      if ('reason' in a) return a;
      const vol = intOption(tag, a.options, 'vol', 100, 100);
      if (typeof vol === 'object') return vol;
      const [sfx] = a.positional as [string];
      if (!assets.hasSfx(sfx)) return unknownAsset(tag, `sfx '${sfx}'`);
      return { kind: 'command', command: { kind, sfx: sfx as SfxId, vol } };
    }
    case 'wait': {
      const a = readArgs(tag, kind, rawArgs, 1, []);
      if ('reason' in a) return a;
      const [value] = a.positional as [string];
      const ms = int(tag, 'ms', value, 50, MS_MAX);
      if (typeof ms === 'object') return ms;
      return { kind: 'command', command: { kind, ms } };
    }
    default: {
      const unhandled: never = kind;
      throw new Error(`invariant: unhandled tag kind ${String(unhandled)}`);
    }
  }
}

function one(raw: string, assets: AssetIndex): One | TagError {
  const tag = raw.trim();
  const m = TAG_RE.exec(tag);
  const kind = m?.[1];
  if (m === null || kind === undefined) {
    return fail(tag, 'syntax', 'expected kind[: args] in lowercase ASCII (§2)');
  }
  if (!isTagKind(kind)) {
    return fail(tag, 'unknown-kind', `'${kind}' is not a tag kind (§6)`);
  }
  if (kind === 'id') {
    const a = readArgs(tag, kind, m[2], 1, []);
    if ('reason' in a) return { kind: 'id', id: null, error: a };
    const [id] = a.positional as [string];
    return LINE_ID_RE.test(id)
      ? { kind: 'id', id: id as LineId, error: null } // the brand is earned by LINE_ID_RE
      : { kind: 'id', id: null, error: fail(tag, 'bad-id', `'${id}' does not match ${LINE_ID_RE.source}`) };
  }
  return command(tag, kind, m[2], assets);
}

/** §7: two commands for the same target in one batch (and D5: `hide: all` names every character). */
function conflictsOneWay(a: StagingCommand, b: StagingCommand): boolean {
  switch (a.kind) {
    case 'bg':
      return b.kind === 'bg' || b.kind === 'scene';
    case 'scene':
      return b.kind === 'scene' || b.kind === 'hide' || b.kind === 'cg';
    case 'show':
      return (b.kind === 'show' && b.char === a.char) || (b.kind === 'hide' && (b.char === 'all' || b.char === a.char));
    case 'cg':
    case 'bgm':
    case 'wait':
      return b.kind === a.kind;
    case 'hide':
    case 'sfx':
      return false;
    default: {
      const unhandled: never = a;
      throw new Error(`invariant: unhandled command ${String(unhandled)}`);
    }
  }
}

/**
 * Parses one batch of tags (one displayed step, §1) into a line ID and typed commands. Every problem is an error
 * value: a tag with an error yields no command, and a conflict is reported on the later of the two tags.
 */
export function parseTags(tags: readonly string[], assets: AssetIndex): ParsedTags {
  let lineId: LineId | null = null;
  let ids = 0;
  const commands: StagingCommand[] = [];
  const sources: string[] = [];
  const errors: TagError[] = [];
  for (const raw of tags) {
    const r = one(raw, assets);
    if ('reason' in r) {
      errors.push(r);
    } else if (r.kind === 'id') {
      ids += 1;
      if (ids > 1) {
        errors.push(fail(raw.trim(), 'multiple-id', 'a line or choice carries exactly one id (§4)'));
      } else if (r.error !== null) {
        errors.push(r.error);
      } else {
        lineId = r.id;
      }
    } else {
      commands.push(r.command);
      sources.push(raw.trim());
    }
  }
  commands.forEach((later, i) => {
    const j = commands.findIndex((earlier, k) => k < i && (conflictsOneWay(earlier, later) || conflictsOneWay(later, earlier)));
    if (j >= 0) {
      errors.push(fail(sources[i] ?? '', 'conflict', `conflicts with '${sources[j] ?? ''}' in the same batch (§7)`));
    }
  });
  return { lineId, commands, errors };
}
