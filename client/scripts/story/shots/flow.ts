// The step flow of one chapter (docs/plans/shots §3.4, lane SH2): the runtime's presented steps (`game.ts` `present`)
// as a graph over the classified ink sources, with the batch each way into a step runs. Steps are keyed as the runtime
// keys them: a text line by its line ID, each choice of a choice set by its own ID (one window), a knot entry (the
// first knot, a puzzle's `then`, an explore section's knots) by `k:<knot>`; the yield step itself has no key (cut D9).
// CFG rules: weave depth for choices and gathers; diverts enter a knot's first step; tunnels add call and every-return
// edges; conditional and sequence blocks take every arm (and skip them when no arm must run); sticky and fallback
// choices count; END and DONE end a path; a yield leads to its `then` knot, an explore yield to its section's knots
// (cross-check only, `explore`). Pure, no node:*, no inkjs; tags are read only through `parseTags`.
import type { Cast } from '../../../src/story/catalog.ts';
import type { AssetIndex, ChapterId, CharId, KnotName, LineId, SpeakerId, StagingCommand, YieldCommand } from '../../../src/story/staging.ts';
import { YIELD_KINDS, parseTags, tagKind } from '../../../src/story/tags.ts';
import type { RoomId } from '../../../src/world/types.ts';
import { classify } from '../classify.ts';
import type { Divert, LineClass, RawTag, SourceLine } from '../classify.ts';
import type { ChapterGraph } from '../graph.ts';
import { shotFinding } from './lint.ts';
import type { ShotFinding } from './lint.ts';

/** A presented step's key (§3.4): a line ID, or `k:<knot>` for a knot entry. */
export type StepKey = LineId | `k:${KnotName}`;
/** A window's key: a step, or an explore room `r:<room>` (rev. 5, m7: keyed by the room, never its bg). */
export type WindowKey = StepKey | `r:${RoomId}`;
/** A staging command with the story-relative file and 1-based line of its tag. */
export type Placed = { readonly cmd: StagingCommand; readonly file: string; readonly line: number };
/** One way into a step: the steps it follows that way (none for a seeded entry) and the batch it runs. */
export type Batch = { readonly from: readonly StepKey[]; readonly commands: readonly Placed[] };
export type StepFlow = {
  readonly key: StepKey;
  /** Where the line or choice is (a knot entry: its knot header), story-relative. */
  readonly file: string;
  readonly line: number;
  /** The steps (and from C6b the room windows) the lookahead walks to; the cross-check accepts them too. */
  readonly next: readonly WindowKey[];
  /** Cross-check only: the section knots an explore yield after this step can enter after any explore actions. */
  readonly explore: readonly StepKey[];
  /** One batch per distinct command list into the step (a tag-only line on one path only makes two). */
  readonly batches: readonly Batch[];
  /** The speaker's character; null for narration, an off-screen speaker and a choice. */
  readonly speaker: CharId | null;
  /** Some batch into the step carries `think`. */
  readonly think: boolean;
};
export type ChapterFlow = {
  readonly chapter: ChapterId;
  /** `k:<first knot>`, or null when the graph has none. */
  readonly first: StepKey | null;
  readonly steps: ReadonlyMap<StepKey, StepFlow>;
};
export type FlowInput = {
  chapter: ChapterId;
  /** The compile's files (entry first), story-relative, and their sources. */
  files: readonly string[];
  sources: ReadonlyMap<string, string>;
  graph: ChapterGraph;
  /** The effective catalog's index (`effectiveCatalog`), so a declared shot parses. */
  assets: AssetIndex;
  cast: Cast;
};

/** `k:<knot>`. */
export function knotKey(knot: KnotName): StepKey {
  return `k:${knot}`;
}

/** The sections a built graph carries (D2): a missing field is a bug, never "no sections". */
export function graphSections(graph: ChapterGraph): NonNullable<ChapterGraph['sections']> {
  if (graph.sections === undefined) {
    throw new Error('invariant: a built graph has its sections');
  }
  return graph.sections;
}

type File = { readonly name: string; readonly lines: readonly SourceLine[] };
type Block = { readonly open: number; readonly branches: readonly number[]; readonly close: number; readonly arms: readonly number[]; readonly skip: boolean };
/** A walk position: file index, line index, weave depth, the blocks whose arms enclose it, and its knot. */
type State = {
  readonly f: number;
  readonly i: number;
  readonly depth: number;
  readonly blocks: readonly number[];
  /** At a knot's top before any content: a stitch header is entered, not a stop. */
  readonly fresh: boolean;
  /** Process only the line's own content (a block arm's first line, a block's close): its structure is handled. */
  readonly inline: boolean;
  readonly pending: readonly Placed[];
};
type Said = { readonly speaker: string | null; readonly text: string; readonly tags: readonly RawTag[]; readonly diverts: readonly Divert[] };

/** The displayed content a line carries (its text, speaker, tags, diverts), or null for a line that carries none. */
function saidOf(cls: LineClass): Said | null {
  switch (cls.kind) {
    case 'text':
    case 'gather':
    case 'block-open':
    case 'block-branch':
    case 'block-close':
      return cls;
    case 'divert':
      return { speaker: null, text: '', tags: cls.tags, diverts: cls.diverts };
    default:
      return null;
  }
}

/** Walk states per line and context: past it a loop that adds tags every round stops (the runtime caps it too). */
const VISITS_PER_LINE = 64;

function isYield(c: StagingCommand): c is YieldCommand {
  return YIELD_KINDS.some((k) => k === c.kind);
}

class Builder {
  readonly #input: FlowInput;
  readonly #files: File[];
  readonly #knots = new Map<string, { f: number; i: number }>();
  readonly #stitches = new Map<string, { f: number; i: number }>();
  readonly #labels = new Map<string, { f: number; i: number }>();
  readonly #blocks: Array<Map<number, Block>>;
  readonly #owner: Array<Map<number, number>>;
  readonly #depthAt: Array<number[]>;
  readonly findings: ShotFinding[] = [];
  readonly #reported = new Set<string>();
  /** Per step: where it is, its own commands and how its walk continues. */
  readonly nodes = new Map<StepKey, { file: string; line: number; speaker: CharId | null; cont: () => State[] }>();
  readonly #queue: StepKey[] = [];
  /** Per step, per batch signature: the batch. */
  readonly into = new Map<StepKey, Map<string, { from: Set<StepKey>; commands: readonly Placed[] }>>();
  readonly next = new Map<StepKey, Set<WindowKey>>();
  readonly explore = new Map<StepKey, Set<StepKey>>();

  constructor(input: FlowInput) {
    this.#input = input;
    this.#files = input.files.map((name) => ({ name, lines: classify(input.sources.get(name) ?? '') }));
    this.#blocks = this.#files.map(() => new Map());
    this.#owner = this.#files.map(() => new Map());
    this.#depthAt = this.#files.map(() => []);
    this.#files.forEach((file, f) => this.#index(file, f));
  }

  /** Knots, stitches, labels, the blocks with their arms, and each line's static weave depth (tunnel return sites). */
  #index(file: File, f: number): void {
    const stack: Array<{ open: number; branches: number[] }> = [];
    const blocks = this.#blocks[f] ?? new Map<number, Block>();
    const owner = this.#owner[f] ?? new Map<number, number>();
    const depthAt = this.#depthAt[f] ?? [];
    let depth = 0;
    let knot: string | null = null;
    const close = (open: number, branches: readonly number[], at: number): void => {
      const lines = file.lines;
      const openCls = lines[open]?.cls;
      const firstArmEnd = branches[0] ?? at;
      const openSaid = openCls === undefined ? null : saidOf(openCls);
      const inline = openSaid !== null && (openSaid.text !== '' || openSaid.speaker !== null || openSaid.tags.length > 0 || openSaid.diverts.length > 0);
      const body = lines.slice(open + 1, firstArmEnd).some((l) => l.cls.kind !== 'blank' && l.cls.kind !== 'comment');
      const heads = branches.map((b) => {
        const c = lines[b]?.cls;
        return c?.kind === 'block-branch' ? c.head : '';
      });
      const kind = openCls?.kind === 'block-open' ? openCls.block : 'conditional';
      const head = openCls?.kind === 'block-open' ? openCls.head : '';
      const skip = kind === 'conditional' ? !heads.includes('else') : /\bonce\b/.test(head);
      blocks.set(open, { open, branches, close: at, arms: [...(inline || body ? [open] : []), ...branches], skip });
      for (const b of branches) {
        owner.set(b, open);
      }
      if (at >= 0) {
        owner.set(at, open);
      }
    };
    file.lines.forEach((l, i) => {
      const cls = l.cls;
      if (cls.kind === 'knot' || cls.kind === 'stitch') {
        for (const b of stack.splice(0)) {
          close(b.open, b.branches, -1);
        }
        depth = 0;
      }
      if (cls.kind === 'knot') {
        knot = cls.fn ? null : cls.name;
        if (!cls.fn && !this.#knots.has(cls.name)) {
          this.#knots.set(cls.name, { f, i });
        }
      } else if (cls.kind === 'stitch' && knot !== null) {
        this.#stitches.set(`${knot}.${cls.name}`, { f, i });
      } else if ((cls.kind === 'choice' || cls.kind === 'gather') && cls.label !== null && knot !== null) {
        for (const key of [`${knot}|${l.stitch ?? ''}|${cls.label}`, `${knot}|*|${cls.label}`]) {
          if (!this.#labels.has(key)) {
            this.#labels.set(key, { f, i });
          }
        }
      } else if (cls.kind === 'block-open') {
        stack.push({ open: i, branches: [] });
      } else if (cls.kind === 'block-branch') {
        stack[stack.length - 1]?.branches.push(i);
      } else if (cls.kind === 'block-close') {
        const b = stack.pop();
        if (b !== undefined) {
          close(b.open, b.branches, i);
        }
      }
      depthAt[i] = depth;
      if (cls.kind === 'choice') {
        depth = cls.depth;
      } else if (cls.kind === 'gather') {
        depth = cls.depth - 1;
      }
    });
    for (const b of stack.splice(0)) {
      close(b.open, b.branches, -1);
    }
  }

  #unsupported(f: number, i: number, why: string): void {
    const file = this.#files[f]?.name ?? '';
    const line = this.#files[f]?.lines[i]?.line ?? 0;
    const key = `${file}:${line}`;
    if (!this.#reported.has(key)) {
      this.#reported.add(key);
      this.findings.push(shotFinding('flow/unsupported', file, line, `${why}: the step flow does not model it (§14)`));
    }
  }

  /** The commands of literal tags, one tag at a time (dynamic tags and tag errors are the lint's), with their place. */
  #placed(tags: readonly RawTag[], f: number, i: number): Placed[] {
    const file = this.#files[f]?.name ?? '';
    const line = this.#files[f]?.lines[i]?.line ?? 0;
    return tags
      .filter((t) => !t.text.includes('{') && tagKind(t.text) !== 'id')
      .flatMap((t) => parseTags([t.text], this.#input.assets).commands.map((cmd) => ({ cmd, file, line })));
  }

  #lineId(tags: readonly RawTag[]): LineId | null {
    return parseTags(
      tags.filter((t) => tagKind(t.text) === 'id').map((t) => t.text),
      this.#input.assets,
    ).lineId;
  }

  #speaker(speaker: string | null): CharId | null {
    const cast = this.#input.cast;
    return speaker !== null && Object.hasOwn(cast, speaker) ? (cast[speaker as SpeakerId]?.char ?? null) : null; // an own key
  }

  #knotTop(name: string, pending: readonly Placed[]): State | null {
    const at = this.#knots.get(name);
    return at === undefined ? null : { f: at.f, i: at.i + 1, depth: 0, blocks: [], fresh: true, inline: false, pending };
  }

  /** Registers a step and queues its walk; a known step keeps its first place. */
  #ensure(key: StepKey, at: { file: string; line: number; speaker: CharId | null }, cont: () => State[]): void {
    if (!this.nodes.has(key)) {
      this.nodes.set(key, { ...at, cont });
      this.#queue.push(key);
    }
  }

  #edge(from: StepKey, to: StepKey, commands: readonly Placed[]): void {
    (this.next.get(from) ?? this.next.set(from, new Set()).get(from))?.add(to);
    const batches = this.into.get(to) ?? this.into.set(to, new Map()).get(to);
    const sig = commands.map((c) => `${c.file}:${c.line}:${JSON.stringify(c.cmd)}`).join('|');
    const b = batches?.get(sig) ?? { from: new Set<StepKey>(), commands };
    b.from.add(from);
    batches?.set(sig, b);
  }

  /** A seeded entry: a batch with no predecessor (the chapter's first knot, an explore section's knot). */
  seed(key: StepKey): void {
    const batches = this.into.get(key) ?? this.into.set(key, new Map()).get(key);
    if (!batches?.has('')) {
      batches?.set('', { from: new Set(), commands: [] });
    }
  }

  /** The first knot's entry and everything reachable from it. */
  run(first: KnotName | null): void {
    if (first !== null) {
      const key = knotKey(first);
      const at = this.#knots.get(first);
      this.seed(key);
      this.#knotEntry(key, first, at);
    }
    for (let k = this.#queue.shift(); k !== undefined; k = this.#queue.shift()) {
      const node = this.nodes.get(k);
      if (node !== undefined) {
        this.#walk(k, node.cont());
      }
    }
  }

  #knotEntry(key: StepKey, knot: string, at: { f: number; i: number } | undefined): void {
    const header = at === undefined ? undefined : this.#files[at.f]?.lines[at.i];
    this.#ensure(key, { file: this.#files[at?.f ?? 0]?.name ?? '', line: header?.line ?? 0, speaker: null }, () => {
      const top = this.#knotTop(knot, []);
      return top === null ? [] : [top];
    });
  }

  /** Walks every path from the states until each reaches a step, a yield or an end; records the edges from `from`. */
  #walk(from: StepKey, start: readonly State[]): void {
    const stack = [...start];
    const seen = new Set<string>();
    const visits = new Map<string, number>();
    for (let s = stack.pop(); s !== undefined; s = stack.pop()) {
      // Two paths reach one line with different batches: both are walked (each batch is its own way into a step).
      const at = `${s.f}:${s.i}:${s.depth}:${s.blocks.join(',')}:${s.fresh}:${s.inline}`;
      const sig = `${at}:${s.pending.map((p) => `${p.file}:${p.line}:${JSON.stringify(p.cmd)}`).join('|')}`;
      const n = visits.get(at) ?? 0;
      if (seen.has(sig) || n >= VISITS_PER_LINE) {
        continue; // a loop with no displayed step (the runtime's play/step-cap), or one adding tags every round
      }
      seen.add(sig);
      visits.set(at, n + 1);
      stack.push(...this.#step(from, s));
    }
  }

  /** One line of the walk: the states it leads to (none at a step, a yield or an end, which it records). */
  #step(from: StepKey, s: State): State[] {
    const file = this.#files[s.f];
    const l = file?.lines[s.i];
    if (file === undefined || l === undefined) {
      this.#stop(from, s);
      return [];
    }
    const cls = l.cls;
    const on = (patch: Partial<State>): State[] => [{ ...s, inline: false, ...patch }];
    if (s.inline) {
      const said = saidOf(cls);
      return said === null ? on({ i: s.i + 1 }) : this.#content(from, s, said);
    }
    switch (cls.kind) {
      case 'blank':
      case 'comment':
      case 'todo':
      case 'include':
      case 'decl':
      case 'logic':
        return on({ i: s.i + 1 });
      case 'tags':
        return on({ i: s.i + 1, pending: [...s.pending, ...this.#placed(cls.tags, s.f, s.i)] });
      case 'knot':
        this.#stop(from, s); // the knot's content ran out
        return [];
      case 'stitch':
        if (s.fresh) {
          return on({ i: s.i + 1 }); // a knot with no content of its own enters its first stitch
        }
        this.#stop(from, s);
        return [];
      case 'thread':
        this.#unsupported(s.f, s.i, `thread '<- ${cls.target}'`);
        return [];
      case 'text':
      case 'divert':
        return this.#content(from, s, saidOf(cls) ?? { speaker: null, text: '', tags: [], diverts: [] });
      case 'gather':
        if (s.blocks.length > 0) {
          this.#unsupported(s.f, s.i, 'a gather inside a conditional or sequence block');
          return [];
        }
        return this.#content(from, { ...s, depth: cls.depth - 1, fresh: false }, cls);
      case 'choice':
        if (s.blocks.length > 0) {
          this.#unsupported(s.f, s.i, 'a choice inside a conditional or sequence block');
          return [];
        }
        return this.#choice(from, s, cls);
      case 'block-open': {
        const b = this.#blocks[s.f]?.get(s.i);
        if (b === undefined) {
          return on({ i: s.i + 1 });
        }
        const arms = b.arms.map((a): State => ({ ...s, i: a, blocks: [...s.blocks, b.open], fresh: false, inline: true }));
        return b.skip && b.close >= 0 ? [...arms, { ...s, i: b.close, fresh: false, inline: true }] : arms;
      }
      case 'block-branch':
      case 'block-close': {
        // A branch or the close of a block ends the arm the walk is in: on to the line after the block.
        const open = this.#owner[s.f]?.get(s.i);
        const b = open === undefined ? undefined : this.#blocks[s.f]?.get(open);
        if (b === undefined || b.close < 0) {
          return on({ i: s.i + 1 });
        }
        const depth = s.blocks.indexOf(b.open);
        return [{ ...s, i: b.close, blocks: depth < 0 ? s.blocks : s.blocks.slice(0, depth), fresh: false, inline: true }];
      }
      default: {
        const unhandled: never = cls;
        throw new Error(`invariant: unhandled line class ${String(unhandled)}`);
      }
    }
  }

  /** A line's own content: a displayed line with an ID is a step; anything else adds its commands and moves on. */
  #content(from: StepKey, s: State, said: Said): State[] {
    const file = this.#files[s.f]?.name ?? '';
    const line = this.#files[s.f]?.lines[s.i]?.line ?? 0;
    const own = this.#placed(said.tags, s.f, s.i);
    const id = this.#lineId(said.tags);
    if ((said.text !== '' || said.speaker !== null) && id !== null) {
      this.#edge(from, id, [...s.pending, ...own]);
      const after: State = { ...s, inline: false, fresh: false, pending: [] };
      this.#ensure(id, { file, line, speaker: this.#speaker(said.speaker) }, () => this.#after(after, said.diverts));
      return [];
    }
    // A tag-only or unkeyed line: its commands join the next displayed step's batch (STAGING-DSL §3.5).
    return this.#after({ ...s, inline: false, fresh: s.fresh && said.text === '' && said.speaker === null, pending: [...s.pending, ...own] }, said.diverts);
  }

  /** After a line: its diverts, else the next line. */
  #after(s: State, diverts: readonly Divert[]): State[] {
    return diverts.length > 0 ? this.#follow(s, diverts) : [{ ...s, i: s.i + 1 }];
  }

  #choice(from: StepKey, s: State, cls: Extract<LineClass, { kind: 'choice' }>): State[] {
    const lines = this.#files[s.f]?.lines ?? [];
    if (cls.depth <= s.depth) {
      // The branch the walk is in ends: its loose end flows to the next gather of its depth or less.
      for (let k = s.i + 1; k < lines.length; k += 1) {
        const c = lines[k]?.cls;
        if (c === undefined || c.kind === 'knot' || c.kind === 'stitch') {
          break;
        }
        if (c.kind === 'gather' && c.depth <= s.depth) {
          return [{ ...s, i: k, inline: false, fresh: false }];
        }
      }
      this.#stop(from, s);
      return [];
    }
    // A choice set at this depth: its choices up to a gather of the depth or less, a shallower choice or a header.
    const members: number[] = [];
    for (let k = s.i; k < lines.length; k += 1) {
      const c = lines[k]?.cls;
      if (c === undefined || c.kind === 'knot' || c.kind === 'stitch' || (c.kind === 'gather' && c.depth <= cls.depth) || (c.kind === 'choice' && c.depth < cls.depth)) {
        break;
      }
      if (c.kind === 'choice' && c.depth === cls.depth) {
        members.push(k);
      }
    }
    const out: State[] = [];
    const file = this.#files[s.f]?.name ?? '';
    for (const m of members) {
      const c = lines[m]?.cls;
      if (c?.kind !== 'choice') {
        continue;
      }
      const own = this.#placed(c.bracket === null ? c.afterTags : c.bracket.tags, s.f, m);
      const trailing = c.bracket === null ? [] : this.#placed(c.afterTags, s.f, m);
      const id = this.#lineId(c.bracket === null ? c.afterTags : c.bracket.tags);
      const branch: State = { ...s, i: m, depth: c.depth, inline: false, fresh: false, pending: trailing };
      const hasText = (c.bracket?.text ?? '') !== '' || c.outside !== '';
      if (hasText && id !== null) {
        // The set's batch runs with the choices (§3.5): every choice of the set gets it, one window.
        this.#edge(from, id, [...s.pending, ...own]);
        this.#ensure(id, { file, line: lines[m]?.line ?? 0, speaker: null }, () => this.#after(branch, c.diverts));
      } else {
        // A fallback choice is never shown: the runtime follows it when no other is offered, the batch carried along.
        out.push(...this.#after({ ...branch, pending: [...s.pending, ...trailing] }, c.diverts));
      }
    }
    return out;
  }

  /** Follows a line's diverts (one decides; a tunnel call returns at every `->->`, conservative). */
  #follow(s: State, diverts: readonly Divert[]): State[] {
    for (const d of diverts) {
      if (d.target === '->') {
        return this.#returnSites().map((r) => ({ ...r, pending: s.pending }));
      }
      const target = this.#resolve(s, d.target);
      if (target === 'end') {
        return [{ ...s, i: Number.MAX_SAFE_INTEGER }]; // a stop: the yield check runs on the pending batch
      }
      if (target === null) {
        this.#unsupported(s.f, s.i, `divert '-> ${d.target}' to no knot, stitch or label`);
        return [];
      }
      return [{ ...target, pending: s.pending }];
    }
    return [{ ...s, i: s.i + 1 }];
  }

  /** Every tunnel call's return site: the rest of its line's diverts, else the next line, at the line's own depth. */
  #returnSites(): State[] {
    const out: State[] = [];
    this.#files.forEach((file, f) => {
      file.lines.forEach((l, i) => {
        const said = saidOf(l.cls);
        const diverts = said?.diverts ?? (l.cls.kind === 'choice' ? l.cls.diverts : []);
        diverts.forEach((d, j) => {
          if (!d.tunnel || d.target === '->') {
            return;
          }
          const s: State = { f, i, depth: this.#depthAt[f]?.[i] ?? 0, blocks: [], fresh: false, inline: false, pending: [] };
          const rest = diverts.slice(j + 1);
          out.push(...(rest.length > 0 ? this.#follow(s, rest) : [{ ...s, i: i + 1 }]));
        });
      });
    });
    return out;
  }

  /** Where `-> target` written at `s` leads: a state, 'end' (END, DONE), or null when it names nothing. */
  #resolve(s: State, target: string): State | 'end' | null {
    if (target === 'END' || target === 'DONE') {
      return 'end';
    }
    const here = this.#files[s.f]?.lines[s.i];
    const knot = here?.knot ?? null;
    const stitch = here?.stitch ?? null;
    const parts = target.split('.');
    const at = (p: { f: number; i: number } | undefined): State | null => {
      if (p === undefined) {
        return null;
      }
      const c = this.#files[p.f]?.lines[p.i]?.cls;
      if (c?.kind === 'stitch') {
        return { f: p.f, i: p.i + 1, depth: 0, blocks: [], fresh: false, inline: false, pending: [] };
      }
      if (c?.kind === 'choice') {
        // A divert to a labelled choice runs its branch, as if it were picked.
        return { f: p.f, i: p.i + 1, depth: c.depth, blocks: [], fresh: false, inline: false, pending: [] };
      }
      return { f: p.f, i: p.i, depth: 0, blocks: [], fresh: false, inline: false, pending: [] }; // a gather sets its depth
    };
    if (parts.length === 1) {
      const local = knot === null ? undefined : (this.#labels.get(`${knot}|${stitch ?? ''}|${target}`) ?? this.#labels.get(`${knot}|*|${target}`) ?? this.#stitches.get(`${knot}.${target}`));
      if (local !== undefined) {
        return at(local);
      }
      return this.#knotTop(target, []);
    }
    const [a = '', b = '', c] = parts;
    if (this.#knots.has(a)) {
      return at(c !== undefined ? this.#labels.get(`${a}|${b}|${c}`) : (this.#stitches.get(`${a}.${b}`) ?? this.#labels.get(`${a}||${b}`)));
    }
    if (knot !== null && c === undefined) {
      return at(this.#labels.get(`${knot}|${a}|${b}`));
    }
    return null;
  }

  /** A path stops (END, DONE, its content ran out): a yield left in its batch leads on (cut D9), else it ends. */
  #stop(from: StepKey, s: State): void {
    const y = s.pending.find((p) => isYield(p.cmd));
    if (y === undefined || !isYield(y.cmd)) {
      return;
    }
    const sections = graphSections(this.#input.graph);
    const yielding = this.#knotOfLine(y.file, y.line);
    if (y.cmd.kind === 'puzzle') {
      const then = y.cmd.then;
      if (!this.#knots.has(then)) {
        return; // `puzzle/then-unknown`
      }
      const key = knotKey(then);
      this.#edge(from, key, s.pending);
      this.#knotEntry(key, then, this.#knots.get(then));
      return;
    }
    const knots = yielding === null ? [] : (sections.edges.get(yielding as KnotName) ?? []); // a compiled knot name
    for (const k of knots) {
      const key = knotKey(k);
      (this.explore.get(from) ?? this.explore.set(from, new Set()).get(from))?.add(key);
      this.seed(key);
      this.#knotEntry(key, k, this.#knots.get(k));
    }
  }

  #knotOfLine(file: string, line: number): string | null {
    const f = this.#files.find((x) => x.name === file);
    return f?.lines.find((l) => l.line === line)?.knot ?? null;
  }
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The step flow of one compiled chapter (§3.4): every presented step reachable from the first knot's entry, with its
 * successors and its batches; `flow/unsupported` for a construct the flow does not model (a thread, a divert to no
 * knot, stitch or label, a choice or a gather inside a conditional or sequence block). Findings name story-relative
 * files, as the graph's do.
 */
export function buildFlow(input: FlowInput): { flow: ChapterFlow; findings: ShotFinding[] } {
  const b = new Builder(input);
  b.run(input.graph.firstKnot);
  const steps = new Map<StepKey, StepFlow>();
  for (const [key, node] of [...b.nodes].sort(([x], [y]) => order(x, y))) {
    const batches: Batch[] = [...(b.into.get(key)?.values() ?? [])].map((x) => ({ from: [...x.from].sort(order), commands: x.commands }));
    steps.set(key, {
      key,
      file: node.file,
      line: node.line,
      next: [...(b.next.get(key) ?? [])].sort(order),
      explore: [...(b.explore.get(key) ?? [])].sort(order),
      batches,
      speaker: node.speaker,
      think: batches.some((x) => x.commands.some((c) => c.cmd.kind === 'think')),
    });
  }
  const first = input.graph.firstKnot === null ? null : knotKey(input.graph.firstKnot);
  return { flow: { chapter: input.chapter, first, steps }, findings: b.findings };
}
