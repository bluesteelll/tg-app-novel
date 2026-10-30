// Classifies ink source lines, one class per line, for the story lint and the story build (L3b reads this module and
// never edits it). Pure and free of node:*: the app program compiles it too, through src/story/dsl-doc.test.ts.
//
// Comments are removed first, exactly as inkjs's CommentEliminator does before it parses: `//` to the end of the
// line anywhere on a line (no string or escape awareness), and `/* … */` across lines, keeping every newline so that
// line numbers stay those of the source. A tag inside a comment is therefore never a tag, as in the compiled story.
import { splitSpeaker } from '../../src/story/tags.ts';

/**
 * A tag as written: the text after an unescaped `#`, trimmed. Columns here are 1-based columns of `code` (the line
 * after comment removal), which equal the source columns unless an inline block comment comes earlier on the line.
 */
export type RawTag = { text: string; col: number };
/**
 * A divert as written: 'k', 'k.s', 'k.s.g', 'END', 'DONE', or '->' for a tunnel return (`->->`); `col` is the
 * 1-based column of its `->`. `tunnel` marks a tunnel call (`-> k ->`) or a tunnel return.
 */
export type Divert = { target: string; col: number; tunnel: boolean };

export type LineClass =
  | { kind: 'blank' }
  | { kind: 'comment' }
  | { kind: 'todo'; text: string }
  | { kind: 'include'; path: string }
  | { kind: 'decl'; keyword: 'VAR' | 'CONST' | 'LIST' | 'EXTERNAL'; name: string; value: string }
  | { kind: 'knot'; name: string; params: string | null; fn: boolean }
  | { kind: 'stitch'; name: string; params: string | null }
  | { kind: 'tags'; tags: RawTag[] }
  | { kind: 'text'; speaker: string | null; text: string; tags: RawTag[]; diverts: Divert[] }
  | {
      kind: 'choice';
      depth: number;
      sticky: boolean;
      label: string | null;
      condition: string | null;
      /** Text before `[` and after `]`, diverts and tags removed; for a choice without brackets, all its text. */
      outside: string;
      bracket: { text: string; tags: RawTag[] } | null;
      /** Tags after `]`; for a choice without brackets, every tag of the line. */
      afterTags: RawTag[];
      diverts: Divert[];
    }
  | {
      kind: 'gather';
      depth: number;
      label: string | null;
      speaker: string | null;
      text: string;
      tags: RawTag[];
      diverts: Divert[];
    }
  | { kind: 'divert'; diverts: Divert[]; tunnel: boolean; tags: RawTag[] }
  | { kind: 'thread'; target: string }
  | { kind: 'logic'; code: string; tags: RawTag[] }
  | {
      kind: 'block-open';
      block: 'conditional' | 'sequence';
      head: string;
      /** Content after the head's `:` on the same line (ink allows it); usually empty. */
      speaker: string | null;
      text: string;
      tags: RawTag[];
      diverts: Divert[];
    }
  | {
      kind: 'block-branch';
      block: 'conditional' | 'sequence';
      /** The condition of `- cond:` in a conditional block; '' for a sequence item. */
      head: string;
      speaker: string | null;
      text: string;
      tags: RawTag[];
      diverts: Divert[];
    }
  | {
      kind: 'block-close';
      /** Content after the `}` on the same line: ink prints it as an ordinary line; usually empty. */
      speaker: string | null;
      text: string;
      tags: RawTag[];
      diverts: Divert[];
    };

/** One source line: `raw` as written, `code` after comment removal, the knot and stitch it sits in. */
export type SourceLine = {
  line: number;
  raw: string;
  code: string;
  knot: string | null;
  stitch: string | null;
  cls: LineClass;
};

const BOM = String.fromCharCode(0xfeff);
const SEQUENCE_HEADS = new Set(['stopping', 'cycle', 'shuffle', 'once', 'shuffle once', 'shuffle stopping']);
const IDENT_RE = /[\p{L}\p{N}_.]/u;

/** inkjs CommentEliminator: comments become nothing, and a block comment keeps its newlines. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i += 1;
      }
    } else if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2);
      const stop = close < 0 ? source.length : close + 2;
      out += '\n'.repeat(source.slice(i, stop).split('\n').length - 1);
      i = stop;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

/** Index of the first `ch` in [from, to) not escaped by a backslash (ink's escape), or -1. */
export function findUnescaped(s: string, ch: string, from: number, to: number = s.length): number {
  for (let i = from; i < to; i += 1) {
    if (s[i] === '\\') {
      i += 1;
    } else if (s[i] === ch) {
      return i;
    }
  }
  return -1;
}

/** The text as displayed: ink's backslash escapes resolved. */
export function unescapeInk(text: string): string {
  return text.replace(/\\(.)/gu, '$1');
}

function splitTags(code: string, from: number, to: number): { end: number; tags: RawTag[] } {
  const first = findUnescaped(code, '#', from, to);
  if (first < 0) {
    return { end: to, tags: [] };
  }
  const tags: RawTag[] = [];
  for (let at = first; at >= 0; ) {
    const next = findUnescaped(code, '#', at + 1, to);
    tags.push({ text: code.slice(at + 1, next < 0 ? to : next).trim(), col: at + 1 });
    at = next;
  }
  return { end: first, tags };
}

type Token = { kind: 'arrow'; at: number } | { kind: 'ident'; text: string } | { kind: 'other' };

function divertTokens(code: string, from: number, to: number): Token[] {
  const tokens: Token[] = [];
  let i = from;
  while (i < to) {
    const c = code[i] ?? '';
    if (c === ' ' || c === '\t') {
      i += 1;
    } else if (code.startsWith('->', i) && i + 1 < to) {
      tokens.push({ kind: 'arrow', at: i });
      i += 2;
    } else if (IDENT_RE.test(c)) {
      let j = i;
      while (j < to && IDENT_RE.test(code[j] ?? '')) {
        j += 1;
      }
      tokens.push({ kind: 'ident', text: code.slice(i, j) });
      i = j;
      if (code[i] === '(') {
        // Divert arguments (`-> k(x)`): skipped; parameters are the knot header's concern.
        const close = code.indexOf(')', i);
        i = close < 0 || close >= to ? to : close + 1;
      }
    } else {
      tokens.push({ kind: 'other' });
      i += 1;
    }
  }
  return tokens;
}

/** The diverts in [from, to) and where the text before the first `->` ends. */
function parseDiverts(code: string, from: number, to: number): { end: number; diverts: Divert[] } {
  const first = code.indexOf('->', from);
  if (first < 0 || first + 1 >= to) {
    return { end: to, diverts: [] };
  }
  const tokens = divertTokens(code, first, to);
  const diverts: Divert[] = [];
  for (let k = 0; k < tokens.length; ) {
    const t = tokens[k];
    const next = tokens[k + 1];
    if (t?.kind !== 'arrow') {
      k += 1;
    } else if (next?.kind === 'ident') {
      // `-> k ->`: the arrow after the target makes it a tunnel call; that arrow may start the next divert.
      const tunnel = tokens[k + 2]?.kind === 'arrow';
      diverts.push({ target: next.text, col: t.at + 1, tunnel });
      k += 2;
    } else if (next?.kind === 'arrow') {
      diverts.push({ target: '->', col: t.at + 1, tunnel: true });
      k += 2;
    } else {
      k += 1;
    }
  }
  return { end: first, diverts };
}

type Content = { text: string; tags: RawTag[]; diverts: Divert[] };
type Spoken = Content & { speaker: string | null };

/** Text, diverts and tags of [from, to): tags start at the first unescaped `#`, diverts at the first `->`. */
function content(code: string, from: number, to: number): Content {
  const { end: tagsAt, tags } = splitTags(code, from, to);
  const { end: textEnd, diverts } = parseDiverts(code, from, tagsAt);
  return { text: code.slice(from, textEnd).trim(), tags, diverts };
}

/** `content` with the speaker prefix split off the text (§5). */
function spoken(code: string, from: number, to: number): Spoken {
  const c = content(code, from, to);
  const split = splitSpeaker(c.text);
  return { ...c, speaker: split.speaker, text: split.text };
}

/** `=== name(params) ===`, `= name(params)`: the header between the `=` runs. */
function header(inner: string): { name: string; params: string | null } {
  const open = inner.indexOf('(');
  if (open < 0) {
    return { name: inner.trim(), params: null };
  }
  const close = inner.lastIndexOf(')');
  return { name: inner.slice(0, open).trim(), params: inner.slice(open + 1, close < open ? inner.length : close).trim() };
}

/** Index of the `}` closing the `{` at `open`, or -1. */
function closingBrace(s: string, open: number, to: number): number {
  let depth = 0;
  for (let i = open; i < to; i += 1) {
    if (s[i] === '\\') {
      i += 1;
    } else if (s[i] === '{') {
      depth += 1;
    } else if (s[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function choice(code: string, from: number, to: number): LineClass {
  let i = from;
  let depth = 0;
  let sticky = false;
  while (i < to && (code[i] === '*' || code[i] === '+' || code[i] === ' ' || code[i] === '\t')) {
    if (code[i] === '*' || code[i] === '+') {
      depth += 1;
      sticky = code[i] === '+';
    }
    i += 1;
  }
  let label: string | null = null;
  const labelMatch = /^\(\s*([^)]*?)\s*\)\s*/.exec(code.slice(i, to));
  if (labelMatch !== null) {
    label = labelMatch[1] ?? '';
    i += labelMatch[0].length;
  }
  const condStart = i;
  while (code[i] === '{') {
    const close = closingBrace(code, i, to);
    if (close < 0) {
      break;
    }
    i = close + 1;
    while (code[i] === ' ' || code[i] === '\t') {
      i += 1;
    }
  }
  const condition = i > condStart ? code.slice(condStart, i).trim() : null;
  const open = findUnescaped(code, '[', i, to);
  const hash = findUnescaped(code, '#', i, to);
  const close = open < 0 ? -1 : findUnescaped(code, ']', open + 1, to);
  if (open >= 0 && close >= 0 && (hash < 0 || open < hash)) {
    const inner = splitTags(code, open + 1, close);
    const after = content(code, close + 1, to);
    const before = code.slice(i, open).trim();
    return {
      kind: 'choice',
      depth,
      sticky,
      label,
      condition,
      outside: [before, after.text].filter((s) => s !== '').join(' '),
      bracket: { text: code.slice(open + 1, inner.end).trim(), tags: inner.tags },
      afterTags: after.tags,
      diverts: after.diverts,
    };
  }
  const rest = content(code, i, to);
  return {
    kind: 'choice',
    depth,
    sticky,
    label,
    condition,
    outside: rest.text,
    bracket: null,
    afterTags: rest.tags,
    diverts: rest.diverts,
  };
}

function gather(code: string, from: number, to: number): LineClass {
  let i = from;
  let depth = 0;
  while (i < to && (code[i] === ' ' || code[i] === '\t' || (code[i] === '-' && code[i + 1] !== '>'))) {
    if (code[i] === '-') {
      depth += 1;
    }
    i += 1;
  }
  let label: string | null = null;
  const labelMatch = /^\(\s*([^)]*?)\s*\)\s*/.exec(code.slice(i, to));
  if (labelMatch !== null) {
    label = labelMatch[1] ?? '';
    i += labelMatch[0].length;
  }
  return { kind: 'gather', depth, label, ...spoken(code, i, to) };
}

/** Unescaped `{` minus `}` on [from, to). */
function braceBalance(code: string, from: number, to: number): number {
  let balance = 0;
  for (let i = from; i < to; i += 1) {
    if (code[i] === '\\') {
      i += 1;
    } else if (code[i] === '{') {
      balance += 1;
    } else if (code[i] === '}') {
      balance -= 1;
    }
  }
  return balance;
}

type Block = 'conditional' | 'sequence';
type State = { knot: string | null; stitch: string | null; blocks: Block[] };

function classifyLine(raw: string, code: string, state: State): LineClass {
  const from = code.length - code.trimStart().length;
  const to = code.trimEnd().length;
  const t = code.slice(from, to);
  if (t === '') {
    return raw.trim() === '' ? { kind: 'blank' } : { kind: 'comment' };
  }
  const block = state.blocks[state.blocks.length - 1];
  if (t.startsWith('}')) {
    state.blocks.pop();
    return { kind: 'block-close', ...spoken(code, from + 1, to) };
  }
  if (block !== undefined && t.startsWith('-') && !t.startsWith('->')) {
    const dash = from + 1;
    if (block === 'sequence') {
      return { kind: 'block-branch', block, head: '', ...spoken(code, dash, to) };
    }
    const colon = code.indexOf(':', dash);
    if (colon < 0 || colon >= to) {
      return { kind: 'block-branch', block, head: code.slice(dash, to).trim(), speaker: null, text: '', tags: [], diverts: [] };
    }
    return { kind: 'block-branch', block, head: code.slice(dash, colon).trim(), ...spoken(code, colon + 1, to) };
  }
  const todo = /^TODO\s*:\s*(.*)$/.exec(t);
  if (todo !== null) {
    return { kind: 'todo', text: todo[1] ?? '' };
  }
  const include = /^INCLUDE\s+(.*)$/.exec(t);
  if (include !== null) {
    return { kind: 'include', path: (include[1] ?? '').trim() };
  }
  const decl = /^(VAR|CONST|LIST)\s+([^\s=]*)\s*(?:=\s*(.*))?$/.exec(t);
  if (decl !== null) {
    const keyword = decl[1] === 'VAR' ? 'VAR' : decl[1] === 'CONST' ? 'CONST' : 'LIST';
    return { kind: 'decl', keyword, name: decl[2] ?? '', value: (decl[3] ?? '').trim() };
  }
  const external = /^EXTERNAL\s+([^\s(]*)\s*(.*)$/.exec(t);
  if (external !== null) {
    return { kind: 'decl', keyword: 'EXTERNAL', name: external[1] ?? '', value: (external[2] ?? '').trim() };
  }
  if (t.startsWith('==')) {
    const inner = t.replace(/^=+/, '').replace(/=+$/, '').trim();
    const fn = /^function\s/.test(inner);
    const { name, params } = header(fn ? inner.replace(/^function\s+/, '') : inner);
    state.knot = name;
    state.stitch = null;
    state.blocks = [];
    return { kind: 'knot', name, params, fn };
  }
  if (t.startsWith('=')) {
    const { name, params } = header(t.slice(1));
    state.stitch = name;
    return { kind: 'stitch', name, params };
  }
  if (t.startsWith('*') || t.startsWith('+')) {
    return choice(code, from, to);
  }
  if (t.startsWith('-') && !t.startsWith('->')) {
    return gather(code, from, to);
  }
  if (t.startsWith('~')) {
    const { end, tags } = splitTags(code, from + 1, to);
    return { kind: 'logic', code: code.slice(from + 1, end).trim(), tags };
  }
  if (t.startsWith('<-')) {
    return { kind: 'thread', target: t.slice(2).trim() };
  }
  if (t.startsWith('->')) {
    const c = content(code, from, to);
    return { kind: 'divert', diverts: c.diverts, tunnel: c.diverts.some((d) => d.tunnel), tags: c.tags };
  }
  if (t.startsWith('#')) {
    return { kind: 'tags', tags: splitTags(code, from, to).tags };
  }
  if (t.startsWith('{') && braceBalance(code, from, to) > 0) {
    const colon = code.indexOf(':', from + 1);
    const head = (colon < 0 ? code.slice(from + 1, to) : code.slice(from + 1, colon)).trim();
    const kind: Block = SEQUENCE_HEADS.has(head.replace(/\s+/g, ' ')) ? 'sequence' : 'conditional';
    state.blocks.push(kind);
    const rest: Spoken = colon < 0 ? { speaker: null, text: '', tags: [], diverts: [] } : spoken(code, colon + 1, to);
    return { kind: 'block-open', block: kind, head, ...rest };
  }
  return { kind: 'text', ...spoken(code, from, to) };
}

/**
 * Classifies every line of one ink file. Never throws; CRLF and a leading BOM are accepted. Any line that is no other
 * construct is `text`, as in ink.
 */
export function classify(source: string): SourceLine[] {
  const text = source.startsWith(BOM) ? source.slice(1) : source;
  const raws = text.split(/\r?\n/);
  const codes = stripComments(text).split(/\r?\n/);
  const state: State = { knot: null, stitch: null, blocks: [] };
  return raws.map((raw, i) => {
    const cls = classifyLine(raw, codes[i] ?? '', state);
    return { line: i + 1, raw, code: codes[i] ?? '', knot: state.knot, stitch: state.stitch, cls };
  });
}

/**
 * For each knot, its opening tag lines (STAGING-DSL §3.3, §8): the `tags` lines after its header and before its first
 * other line. Blank and comment lines are transparent; any other line (text, logic, a stitch header, a choice, a
 * divert, …) ends the run. These are the only clears the build credits (PROTOTYPE-PLAN.md K9).
 */
export function openingTagLines(lines: readonly SourceLine[]): ReadonlyMap<string, readonly SourceLine[]> {
  const out = new Map<string, SourceLine[]>();
  let run: SourceLine[] | null = null;
  for (const l of lines) {
    if (l.cls.kind === 'knot') {
      // A repeated knot name is a compile error (L3b); the first definition keeps its run.
      run = out.has(l.cls.name) ? null : [];
      if (run !== null) {
        out.set(l.cls.name, run);
      }
    } else if (run !== null) {
      if (l.cls.kind === 'tags') {
        run.push(l);
      } else if (l.cls.kind !== 'blank' && l.cls.kind !== 'comment') {
        run = null;
      }
    }
  }
  return out;
}
