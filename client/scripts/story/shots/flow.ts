// The step flow of one chapter (docs/plans/shots §3.4, lane SH2): the runtime's presented steps (`game.ts` `present`)
// as a graph over the classified ink sources, with the batch each way into a step runs. Steps are keyed as the runtime
// keys them: a text line by its line ID, each choice of a choice set by its own ID (one window), a knot entry (the
// first knot, a puzzle's `then`, an explore section's knots) by `k:<knot>`; the yield step itself has no key (cut D9).
// CFG rules: weave depth for choices and gathers; diverts enter a knot's first step; tunnels add call and every-return
// edges; conditional and sequence blocks take every arm (and skip them when no arm must run); sticky and fallback
// choices count; END and DONE end a path; a yield leads to its `then` knot, an explore yield to its section's knots
// (cross-check only, `explore`); an event knot's last step returns to its rooms' windows `r:<room>` and to the event
// knots co-fired after it, an entering explore yield leads to its section's start room window. The may-analysis: what may be on stage after each step's batch, a forward union to a
// fixpoint from the seeds (the first knot: the empty stage; a section knot: its rooms). It is the only code of the
// shot pass that names the legacy kinds `show` / `hide` (rev. 5, W3: SH12a removes them here alone). Pure, no node:*,
// no inkjs; tags are read only through `parseTags`.
import type { Cast } from '../../../src/story/catalog.ts';
import type { AssetId, AssetIndex, BgId, CgId, ChapterId, CharId, ExprId, KnotName, LineId, SpeakerId, StagingCommand, YieldCommand } from '../../../src/story/staging.ts';
import { YIELD_KINDS, parseTags, tagKind } from '../../../src/story/tags.ts';
import type { RoomId, WorldPublicBody } from '../../../src/world/types.ts';
import { classify } from '../classify.ts';
import type { Divert, LineClass, RawTag, SourceLine } from '../classify.ts';
import type { ChapterGraph, ChapterSections } from '../graph.ts';
import { shotFinding } from './lint.ts';
import type { ShotFinding } from './lint.ts';
import type { EffectiveShot } from './list.ts';

/** A presented step's key (§3.4): a line ID, or `k:<knot>` for a knot entry. */
export type StepKey = LineId | `k:${KnotName}`;
/** A window's key: a step, or an explore room `r:<room>` (rev. 5, m7: keyed by the room, never its bg). */
export type WindowKey = StepKey | `r:${RoomId}`;
/** A staging command with the story-relative file and 1-based line of its tag. */
export type Placed = { readonly cmd: StagingCommand; readonly file: string; readonly line: number };
/**
 * What may be on stage at a step, after its batch (may-sets over every path): the shot, the face expressions a `face:`
 * left since the last scene (null: the character's rest in the shot), the CG (null: none), the room whose props are on
 * stage (null: none) and the legacy sprites of `show:` (rev. 3, W5; empty in a shot chapter).
 */
export type Effect = {
  readonly shots: ReadonlySet<BgId>;
  readonly faces: ReadonlyMap<CharId, ReadonlySet<ExprId | null>>;
  readonly cg: ReadonlySet<CgId | null>;
  readonly room: ReadonlySet<RoomId | null>;
  readonly sprites: ReadonlyMap<CharId, ReadonlySet<ExprId>>;
};
/** The stage a chapter starts on (§2.2: a handover restores the empty snapshot). */
export const EMPTY_EFFECT: Effect = { shots: new Set(), faces: new Map(), cg: new Set([null]), room: new Set([null]), sprites: new Map() };
/** A step no path reaches: nothing at all. */
const UNREACHED: Effect = { shots: new Set(), faces: new Map(), cg: new Set(), room: new Set(), sprites: new Map() };
/** The image change a batch makes: its shot cut (`scene:` / `bg:`), else a CG it shows, else none. */
export type Cut = BgId | CgId | null;
/** One way into a step: the steps it follows that way (none for a seeded entry), the batch it runs, and after it. */
export type Batch = { readonly from: readonly StepKey[]; readonly commands: readonly Placed[]; readonly effect: Effect; readonly cut: Cut };
export type StepFlow = {
  readonly key: StepKey;
  /** A text line, a choice of a choice set, or a knot entry. */
  readonly kind: 'line' | 'choice' | 'knot';
  /** A choice's set (every choice of it, itself included: one window); [] for a line or a knot entry. */
  readonly set: readonly StepKey[];
  /** Where the line or choice is (a knot entry: its knot header), story-relative. */
  readonly file: string;
  readonly line: number;
  /** The steps (and from C6b the room windows) the lookahead walks to; the cross-check accepts them too. */
  readonly next: readonly WindowKey[];
  /** Cross-check only: the section knots an explore yield after this step can enter after any explore actions. */
  readonly explore: readonly StepKey[];
  /** One batch per distinct command list into the step (a tag-only line on one path only makes two). */
  readonly batches: readonly Batch[];
  /** The union of the batches' effects. */
  readonly effect: Effect;
  /** The first batch's image change that is not null (a batch's own is `Batch.cut`). */
  readonly cut: Cut;
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
  /** The chapter's public world (default none): which rooms a shot draws, a section knot's seed. */
  world?: WorldPublicBody;
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
  readonly #returns: EventReturns;
  /** Per step: where it is, its own commands and how its walk continues. */
  readonly nodes = new Map<StepKey, { kind: StepFlow['kind']; file: string; line: number; speaker: CharId | null; cont: () => State[] }>();
  /** Per choice, the choices of its set. */
  readonly sets = new Map<StepKey, Set<StepKey>>();
  readonly #queue: StepKey[] = [];
  /** Per step, per batch signature: the batch. */
  readonly into = new Map<StepKey, Map<string, { from: Set<StepKey>; commands: readonly Placed[] }>>();
  readonly next = new Map<StepKey, Set<WindowKey>>();
  readonly explore = new Map<StepKey, Set<StepKey>>();

  constructor(input: FlowInput) {
    this.#input = input;
    this.#returns = eventReturns(input.world, graphSections(input.graph));
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
  #ensure(key: StepKey, at: { kind: StepFlow['kind']; file: string; line: number; speaker: CharId | null }, cont: () => State[]): void {
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
    this.#ensure(key, { kind: 'knot', file: this.#files[at?.f ?? 0]?.name ?? '', line: header?.line ?? 0, speaker: null }, () => {
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
      this.#ensure(id, { kind: 'line', file, line, speaker: this.#speaker(said.speaker) }, () => this.#after(after, said.diverts));
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
    const shown = new Set<StepKey>();
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
        this.#ensure(id, { kind: 'choice', file, line: lines[m]?.line ?? 0, speaker: null }, () => this.#after(branch, c.diverts));
        shown.add(id);
      } else {
        // A fallback choice is never shown: the runtime follows it when no other is offered, the batch carried along.
        out.push(...this.#after({ ...branch, pending: [...s.pending, ...trailing] }, c.diverts));
      }
    }
    for (const id of shown) {
      const set = this.sets.get(id) ?? this.sets.set(id, new Set()).get(id);
      for (const other of shown) {
        set?.add(other);
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
    const next = this.next.get(from) ?? this.next.set(from, new Set()).get(from);
    const back = yielding === null ? undefined : this.#returns.get(yielding as KnotName); // a compiled knot name
    if (back !== undefined) {
      // An event returns (§3.4, rev. 5 W2): the explore runs the next co-fired event, else shows the room it fired in.
      for (const r of back.rooms) {
        next?.add(`r:${r}`);
      }
      for (const k of back.cofiredAfter.filter((x) => this.#knots.has(x))) {
        next?.add(knotKey(k)); // no batch: the next event opens on this one's last image, not on a seed's
        this.seed(knotKey(k));
        this.#knotEntry(knotKey(k), k, this.#knots.get(k));
      }
      return;
    }
    // Entering the section: its start room's window (a resume into another room is that room's entry, D9).
    const world = this.#input.world;
    const section = world !== undefined && Object.hasOwn(world.sections, y.cmd.section) ? world.sections[y.cmd.section] : undefined;
    if (section !== undefined) {
      next?.add(`r:${section.start}`);
    }
  }

  #knotOfLine(file: string, line: number): string | null {
    const f = this.#files.find((x) => x.name === file);
    return f?.lines.find((l) => l.line === line)?.knot ?? null;
  }
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function union<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
  return new Set([...a, ...b]);
}

function joinMap<K, V>(a: ReadonlyMap<K, ReadonlySet<V>>, b: ReadonlyMap<K, ReadonlySet<V>>, absent: ReadonlySet<V>): Map<K, ReadonlySet<V>> {
  const out = new Map<K, ReadonlySet<V>>();
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    out.set(k, union(a.get(k) ?? absent, b.get(k) ?? absent));
  }
  return out;
}

const AT_REST: ReadonlySet<ExprId | null> = new Set([null]);
const NO_SPRITE: ReadonlySet<ExprId> = new Set();
const AT_NO_ROOM: ReadonlySet<RoomId | null> = new Set([null]);

/** The may-join of two effects: a face no `face:` set on one path is at rest there. */
export function joinEffects(a: Effect, b: Effect): Effect {
  return {
    shots: union(a.shots, b.shots),
    faces: joinMap(a.faces, b.faces, AT_REST),
    cg: union(a.cg, b.cg),
    room: union(a.room, b.room),
    sprites: joinMap(a.sprites, b.sprites, NO_SPRITE),
  };
}

function joinAll(effects: readonly Effect[]): Effect | undefined {
  return effects.reduce<Effect | undefined>((acc, e) => (acc === undefined ? e : joinEffects(acc, e)), undefined);
}

function effectKey(e: Effect): string {
  const set = (s: ReadonlySet<string | null>): string[] => [...s].map((x) => x ?? '').sort(order);
  const map = (m: ReadonlyMap<string, ReadonlySet<string | null>>): string[] => [...m].map(([k, v]) => `${k}=${set(v).join(',')}`).sort(order);
  return JSON.stringify([set(e.shots), map(e.faces), set(e.cg), set(e.room), map(e.sprites)]);
}

/**
 * A batch's transfer, in the executor's batch order (`executor.ts` `reduce`; cut D5): `scene` (faces to rest, no CG,
 * no sprites), `bg` (faces and the CG persist), `hide`, `show`, `face`, `cg`. The room in effect is the room whose bg
 * the shot is (I-11 restores its props at runtime), else none. Only here are the legacy kinds named (rev. 5, W3).
 */
function transfer(e: Effect, commands: readonly Placed[], roomsOf: (bg: BgId) => ReadonlySet<RoomId | null>): Effect {
  let { shots, faces, cg, room, sprites } = e;
  const cmds = commands.map((p) => p.cmd);
  const scene = cmds.find((c) => c.kind === 'scene');
  if (scene?.kind === 'scene') {
    shots = new Set([scene.bg]);
    faces = new Map();
    cg = new Set([null]);
    room = roomsOf(scene.bg);
    sprites = new Map();
  }
  const cut = cmds.find((c) => c.kind === 'bg');
  if (cut?.kind === 'bg') {
    shots = new Set([cut.bg]);
    room = roomsOf(cut.bg);
  }
  const shown = new Map(sprites);
  for (const c of cmds) {
    if (c.kind === 'hide') {
      if (c.char === 'all') {
        shown.clear();
      } else {
        shown.delete(c.char);
      }
    }
  }
  for (const c of cmds) {
    if (c.kind === 'show') {
      shown.set(c.char, new Set([c.expr]));
    }
  }
  const facing = new Map(faces);
  for (const c of cmds) {
    if (c.kind === 'face') {
      facing.set(c.char, new Set([c.expr])); // a face changes no sprite: on a legacy chapter it is shot/char-absent (D4)
    }
  }
  const shownCg = cmds.find((c) => c.kind === 'cg');
  if (shownCg?.kind === 'cg') {
    cg = new Set([shownCg.cg]);
  }
  return { shots, faces: facing, cg, room, sprites: shown };
}

/** A batch's image change: its shot cut, else a CG it shows, else null. */
function cutOf(commands: readonly Placed[]): Cut {
  for (const p of commands) {
    if (p.cmd.kind === 'scene' || p.cmd.kind === 'bg') {
      return p.cmd.bg;
    }
  }
  for (const p of commands) {
    if (p.cmd.kind === 'cg' && p.cmd.cg !== null) {
      return p.cmd.cg;
    }
  }
  return null;
}

/** Per bg, the rooms of the chapter's world that draw it (none: `{ null }`). */
function roomIndex(world: WorldPublicBody | undefined): (bg: BgId) => ReadonlySet<RoomId | null> {
  const by = new Map<string, Set<RoomId | null>>();
  for (const s of Object.values(world?.sections ?? {})) {
    for (const [id, r] of Object.entries(s.rooms)) {
      (by.get(r.bg) ?? by.set(r.bg, new Set()).get(r.bg))?.add(id as RoomId); // a decoded room id
    }
  }
  return (bg) => by.get(bg) ?? AT_NO_ROOM;
}

/**
 * The seeds (§3.4 "May-analysis"): the first knot's entry starts on the empty stage (§2.2); a section knot's entry on
 * the shot and room of each room that names it, as `carriedStage` seeds it (`graph.ts`), so the stage of the step
 * before the yield never flows into it.
 */
function seedEffects(input: FlowInput, raw: ReadonlyMap<StepKey, ReadonlyArray<{ from: readonly StepKey[] }>>): Map<StepKey, Effect> {
  const sections = graphSections(input.graph);
  const bgOf = new Map<string, BgId>();
  for (const s of Object.values(input.world?.sections ?? {})) {
    for (const [id, r] of Object.entries(s.rooms)) {
      bgOf.set(id, r.bg);
    }
  }
  const out = new Map<StepKey, Effect>();
  for (const [key, batches] of raw) {
    if (!batches.some((x) => x.from.length === 0)) {
      continue;
    }
    const knot = key.slice('k:'.length);
    const parts: Effect[] = knot === input.graph.firstKnot ? [EMPTY_EFFECT] : [];
    const named = sections.rooms.get(knot as KnotName); // a lookup key
    for (const room of [...(named?.events ?? []), ...(named?.leaves ?? [])]) {
      const bg = bgOf.get(room);
      if (bg !== undefined) {
        parts.push({ ...EMPTY_EFFECT, shots: new Set([bg]), room: new Set([room]) });
      }
    }
    const seed = joinAll(parts);
    if (seed !== undefined) {
      out.set(key, seed);
    }
  }
  return out;
}

/**
 * The step flow of one compiled chapter (§3.4): every presented step reachable from the first knot's entry, with its
 * successors and its batches; `flow/unsupported` for a construct the flow does not model (a thread, a divert to no
 * knot, stitch or label, a choice or a gather inside a conditional or sequence block). Findings name story-relative
 * files, as the graph's do.
 */
export function buildFlow(input: FlowInput): { flow: ChapterFlow; findings: ShotFinding[] } {
  const b = new Builder(input);
  b.run(input.graph.firstKnot);
  const keys = [...b.nodes.keys()].sort(order);
  const raw = new Map(keys.map((k) => [k, [...(b.into.get(k)?.values() ?? [])].map((x) => ({ from: [...x.from].sort(order), commands: x.commands }))]));
  const roomsOf = roomIndex(input.world);
  const seeds = seedEffects(input, raw);
  // The forward may-analysis: a union to a fixpoint (every transfer is monotone, every set finite).
  const effects = new Map<StepKey, Effect>();
  const batchOut = (key: StepKey, x: { from: readonly StepKey[]; commands: readonly Placed[] }): Effect | undefined => {
    const seed = x.from.length === 0 ? seeds.get(key) : undefined;
    const into = joinAll([...x.from.flatMap((f) => effects.get(f) ?? []), ...(seed === undefined ? [] : [seed])]);
    return into === undefined ? undefined : transfer(into, x.commands, roomsOf);
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const key of keys) {
      const out = joinAll((raw.get(key) ?? []).flatMap((x) => batchOut(key, x) ?? []));
      const before = effects.get(key);
      if (out !== undefined && (before === undefined || effectKey(before) !== effectKey(out))) {
        effects.set(key, out);
        changed = true;
      }
    }
  }
  const steps = new Map<StepKey, StepFlow>();
  for (const key of keys) {
    const node = b.nodes.get(key);
    if (node === undefined) {
      continue;
    }
    const batches: Batch[] = (raw.get(key) ?? []).map((x) => ({ ...x, effect: batchOut(key, x) ?? UNREACHED, cut: cutOf(x.commands) }));
    steps.set(key, {
      key,
      kind: node.kind,
      set: [...(b.sets.get(key) ?? [])].sort(order),
      file: node.file,
      line: node.line,
      next: [...(b.next.get(key) ?? [])].sort(order),
      explore: [...(b.explore.get(key) ?? [])].sort(order),
      batches,
      effect: effects.get(key) ?? UNREACHED,
      cut: batches.find((x) => x.cut !== null)?.cut ?? null,
      speaker: node.speaker,
      think: batches.some((x) => x.commands.some((c) => c.cmd.kind === 'think')),
    });
  }
  const first = input.graph.firstKnot === null ? null : knotKey(input.graph.firstKnot);
  return { flow: { chapter: input.chapter, first, steps }, findings: b.findings };
}

/**
 * The cross-check (§3.4): every step transition a seeded run made (`ChapterPlay.transitions`, `"<from>→<to>"`) must be an
 * edge of the flow (`next` or `explore`), else `flow/edge-missing` at the step it leaves (the chapter's entry file when
 * the flow has no such step). Fail-closed only for transitions some run observed (rev. 2, m5).
 */
export function crossCheck(flow: ChapterFlow, transitions: ReadonlySet<string>, entry: string): ShotFinding[] {
  const out: ShotFinding[] = [];
  for (const t of [...transitions].sort(order)) {
    const [a = '', b = ''] = t.split('→');
    const from = flow.steps.get(a as StepKey); // a lookup key: a missing step is the finding
    const known = from !== undefined && (from.next.some((n) => n === b) || from.explore.some((n) => n === b));
    if (!known) {
      const where = from ?? flow.steps.get(b as StepKey); // the same lookup
      out.push(shotFinding('flow/edge-missing', where?.file ?? entry, where?.line ?? 0, `the seeded runs went from '${a}' to '${b}', which the step flow lacks (§14)`));
    }
  }
  return out;
}

/** Per room of the chapter's world: the shot it draws and its picture files beyond the plate (props, decor states). */
export type RoomFiles = ReadonlyMap<RoomId, { readonly shot: BgId; readonly room: readonly AssetId[] }>;
/** What the shot files are: the effective shots and the talk files (`<shot>/<char>/<expr>`: some chapter has the
 *  character speak in that expression in that shot, §2.6). */
export type ShotFiles = { readonly shots: ReadonlyMap<BgId, EffectiveShot>; readonly talk: ReadonlySet<string> };
/**
 * A window's lookahead (§3.4): `cur` the files in effect; `certain` the next appearance's files on every path, at the
 * least distance `certainDist` (presented steps; 0 when nothing is certain); `possible` the other next-appearance
 * files (`near` of them first: at a story step all of them, rev. 6 m3); `d2`, `d3` the two appearances after;
 * `labels` a room is in effect (its label bound).
 */
export type Lookahead = {
  readonly cur: readonly AssetId[];
  readonly certain: readonly AssetId[];
  readonly certainDist: number;
  readonly possible: readonly AssetId[];
  readonly near: number;
  readonly d2: readonly AssetId[];
  readonly d3: readonly AssetId[];
  readonly labels: boolean;
};
export type LookInput = { readonly flow: ChapterFlow; readonly files: ShotFiles; readonly rooms: RoomEvents };

/**
 * Per room of the chapter's world (§3.4 "At an explore yield", rev. 5 m3, m7): its shot, its pictures beyond the plate,
 * `near` = its own knots (named by its hotspots, locks, onEnter and leave exits) and `far` = the onEnter knots of the
 * rooms its exits lead to (their `onEnter` fires on the move), the order a room window fetches their openers in.
 */
export type RoomEvents = ReadonlyMap<
  RoomId,
  { readonly shot: BgId; readonly room: readonly AssetId[]; readonly near: readonly KnotName[]; readonly far: readonly KnotName[] }
>;
/**
 * Per event knot (§3.4 "An event's return", rev. 5 W2): the rooms it is named in as an event (`ChapterSections.rooms`;
 * the explore resumes in the room that fired it) and `cofiredAfter`, the knots a list of effects fires after it (the
 * explore runs the next one instead of showing the room, `reduce.ts` `eventReturned`). A leave knot has no entry.
 */
export type EventReturns = ReadonlyMap<KnotName, { readonly rooms: readonly RoomId[]; readonly cofiredAfter: readonly KnotName[] }>;

/** Every list of effects a room fires, as its story knots in order: its onEnter, a hotspot's `then`, a lock's onOpen and onFail. */
function storyLists(world: WorldPublicBody | undefined): KnotName[][] {
  const out: KnotName[][] = [];
  const knots = (effects: ReadonlyArray<{ story: KnotName } | object>): KnotName[] => effects.flatMap((e) => ('story' in e ? [e.story] : []));
  for (const section of Object.values(world?.sections ?? {})) {
    for (const room of Object.values(section.rooms)) {
      out.push(knots(room.onEnter));
      for (const h of room.hotspots) {
        if (h.kind !== 'exit') {
          out.push(knots(h.then));
        }
        if (h.kind === 'exit' || h.kind === 'object') {
          out.push(knots(h.lock?.onOpen ?? []), knots(h.lock?.onFail ?? []));
        }
      }
    }
  }
  return out;
}

/** The returns of the chapter's event knots (see `EventReturns`). */
export function eventReturns(world: WorldPublicBody | undefined, sections: ChapterSections): EventReturns {
  const after = new Map<KnotName, Set<KnotName>>();
  for (const list of storyLists(world)) {
    list.forEach((k, i) => {
      const later = after.get(k) ?? after.set(k, new Set()).get(k);
      for (const x of list.slice(i + 1).filter((y) => y !== k)) {
        later?.add(x);
      }
    });
  }
  const out = new Map<KnotName, { rooms: RoomId[]; cofiredAfter: KnotName[] }>();
  for (const [knot, named] of sections.rooms) {
    if (named.events.length > 0) {
      out.set(knot, { rooms: [...named.events].sort(order), cofiredAfter: [...(after.get(knot) ?? [])].sort(order) });
    }
  }
  return out;
}

/** The rooms of the chapter's world with their knots one action away (see `RoomEvents`); `pictures` per room (usage props). */
export function roomEvents(world: WorldPublicBody | undefined, sections: ChapterSections, pictures: ReadonlyMap<RoomId, readonly AssetId[]>): RoomEvents {
  const own = new Map<RoomId, Set<KnotName>>();
  for (const [knot, named] of sections.rooms) {
    for (const r of [...named.events, ...named.leaves]) {
      (own.get(r) ?? own.set(r, new Set()).get(r))?.add(knot);
    }
  }
  const out = new Map<RoomId, { shot: BgId; room: readonly AssetId[]; near: KnotName[]; far: KnotName[] }>();
  for (const section of Object.values(world?.sections ?? {})) {
    for (const [key, room] of Object.entries(section.rooms)) {
      const id = key as RoomId; // a decoded room id
      const near = own.get(id) ?? new Set<KnotName>();
      const far = new Set<KnotName>();
      for (const h of room.hotspots) {
        const to = h.kind === 'exit' && 'room' in h.to && Object.hasOwn(section.rooms, h.to.room) ? section.rooms[h.to.room] : undefined;
        for (const e of to?.onEnter ?? []) {
          if ('story' in e && !near.has(e.story)) {
            far.add(e.story);
          }
        }
      }
      out.set(id, { shot: room.bg, room: pictures.get(id) ?? [], near: [...near].sort(order), far: [...far].sort(order) });
    }
  }
  return out;
}

function asset(id: string): AssetId {
  return id as AssetId; // a shot-file or catalog id built from decoded ids (usage.ts checks every id on decode)
}

/** The files of shot `s` with the faces of `e` (talk only when `talk`): plate, sheet, face and talk files (§2.6). */
function shotFiles(s: BgId, e: Effect, files: ShotFiles, talk: boolean): AssetId[] {
  const shot = files.shots.get(s);
  const out = [asset(`bg/${s}`)];
  if ((shot?.cast.length ?? 0) > 0) {
    out.push(asset(`sheet/${s}`));
  }
  for (const m of shot?.cast ?? []) {
    if (m.view !== 'face') {
      continue;
    }
    for (const x of e.faces.get(m.char) ?? AT_REST) {
      const expr = x ?? m.rest;
      if (expr !== m.rest) {
        out.push(asset(`face/${s}/${m.char}/${expr}`));
      }
      if (talk && files.talk.has(`${s}/${m.char}/${expr}`)) {
        out.push(asset(`talk/${s}/${m.char}/${expr}`));
      }
    }
  }
  return out;
}

/** The room pictures in effect with shot `s`: the props and decor of each room in effect that draws it. */
function roomOf(s: BgId, e: Effect, rooms: RoomFiles): AssetId[] {
  return [...e.room].flatMap((r) => {
    const room = r === null ? undefined : rooms.get(r);
    return room !== undefined && room.shot === s ? room.room : [];
  });
}

/**
 * The files a batch makes visible (§3.4 "Appearances"): a `bg:` / `scene:` cut brings the new shot's plate, sheet, the
 * face files of its face members in effect and their talk files, and a room's props when it is a room's shot; a
 * `face:` without a cut brings that face file and its talk file in each shot in effect; a `cg:` brings the CG. A speaker
 * change brings nothing; legacy sprites are the knot-set's.
 */
export function appears(b: Batch, input: Omit<LookInput, 'flow'>): AssetId[] {
  const out = new Set<AssetId>();
  const cut = b.commands.find((p) => p.cmd.kind === 'scene' || p.cmd.kind === 'bg')?.cmd;
  if (cut?.kind === 'scene' || cut?.kind === 'bg') {
    for (const a of [...shotFiles(cut.bg, b.effect, input.files, true), ...roomOf(cut.bg, b.effect, input.rooms)]) {
      out.add(a);
    }
  } else {
    for (const p of b.commands) {
      if (p.cmd.kind !== 'face') {
        continue;
      }
      const { char, expr } = p.cmd;
      for (const s of b.effect.shots) {
        const m = input.files.shots.get(s)?.cast.find((x) => x.char === char && x.view === 'face');
        if (m === undefined) {
          continue;
        }
        if (expr !== m.rest) {
          out.add(asset(`face/${s}/${char}/${expr}`));
        }
        if (input.files.talk.has(`${s}/${char}/${expr}`)) {
          out.add(asset(`talk/${s}/${char}/${expr}`));
        }
      }
    }
  }
  for (const p of b.commands) {
    if (p.cmd.kind === 'cg' && p.cmd.cg !== null) {
      out.add(asset(`cg/${p.cmd.cg}`));
    }
  }
  return [...out].sort(order);
}

/**
 * A step's entry alternatives (§3.4 "Entry alternatives", rev. 3 C1): one per possible top image - a CG of the
 * may-set alone, else a shot of the may-set with its drawn files (plate, sheet, the face files in effect; a room's
 * props) and, in a legacy chapter, every sprite in effect. Talk files are motion, never awaited.
 */
export function entryOf(e: Effect, input: Omit<LookInput, 'flow'>): AssetId[][] {
  const out: AssetId[][] = [];
  for (const c of [...e.cg].sort()) {
    if (c !== null) {
      out.push([asset(`cg/${c}`)]);
    }
  }
  if (e.cg.has(null) || e.cg.size === 0) {
    const sprites = [...e.sprites].flatMap(([c, xs]) => [...xs].map((x) => asset(`char/${c}/${x}`)));
    for (const s of [...e.shots].sort()) {
      out.push([...new Set([...shotFiles(s, e, input.files, false), ...roomOf(s, e, input.rooms), ...sprites])].sort(order));
    }
  }
  return out;
}

/** A lookahead edge: the successor and the files the way into it makes visible; `to: null` = the path ends there. */
type LookEdge = { readonly to: StepKey | null; readonly files: ReadonlySet<AssetId> };

/** A room's files as its window holds them: its shot at rest (talk files when `talk`), its pictures. */
function roomFiles(r: RoomId, input: Omit<LookInput, 'flow'>, talk: boolean): AssetId[] {
  const ev = input.rooms.get(r);
  return ev === undefined ? [] : [...new Set([...shotFiles(ev.shot, EMPTY_EFFECT, input.files, talk), ...ev.room])].sort(order);
}

/** What a return to room `r` makes visible after a step of effect `e`: nothing when the step surely shows the room. */
function returnFiles(e: Effect, r: RoomId, input: Omit<LookInput, 'flow'>): AssetId[] {
  const ev = input.rooms.get(r);
  const shown = ev !== undefined && e.shots.size === 1 && e.shots.has(ev.shot) && e.room.size === 1 && e.room.has(r) && e.cg.size === 1 && e.cg.has(null);
  return shown ? [] : roomFiles(r, input, true);
}

/** Story-step lookahead edges: per step, its successors with the files the way into each makes visible. */
function lookEdges(input: LookInput): Map<StepKey, LookEdge[]> {
  const own = new Map<StepKey, LookEdge[]>();
  for (const step of input.flow.steps.values()) {
    const out: LookEdge[] = [];
    for (const n of step.next) {
      if (n.startsWith('r:')) {
        // A return to a room ends the step flow: the explore resumes, its window is the room's own.
        out.push({ to: null, files: new Set(returnFiles(step.effect, n.slice('r:'.length) as RoomId, input)) }); // an `r:<room>` key
        continue;
      }
      const to = input.flow.steps.get(n as StepKey); // not `r:`: a step key
      if (to === undefined) {
        continue;
      }
      const batches = to.batches.filter((x) => x.from.includes(step.key));
      // No batch from this step: a co-fired event knot, which opens on this step's last image.
      for (const b of batches.length > 0 ? batches : [null]) {
        out.push({ to: to.key, files: new Set(b === null ? [] : appears(b, input)) });
      }
    }
    // A step with no successor ends its paths: kept as an edge so that a choice set's union still sees the end.
    own.set(step.key, out.length > 0 ? out : [{ to: null, files: new Set() }]);
  }
  // A choice set is one window: each choice looks into every branch of its set.
  const edges = new Map<StepKey, LookEdge[]>();
  for (const step of input.flow.steps.values()) {
    const keys = step.set.length > 0 ? step.set : [step.key];
    edges.set(step.key, keys.flatMap((k) => own.get(k) ?? []));
  }
  return edges;
}

function sameSet<T>(a: ReadonlySet<T> | null, b: ReadonlySet<T> | null): boolean {
  return a === b || (a !== null && b !== null && a.size === b.size && [...a].every((x) => b.has(x)));
}

/**
 * The lookahead of every step (§3.4 D_n): over every path from a step, `d1` = the first later appearance, `certain` =
 * the files in the `d1` appearance of every path (a path that ends with none makes it empty), `possible` = the other
 * `d1` files, `d2` / `d3` the two appearances after. Fixpoints: the unions grow from empty, `certain` shrinks from
 * every file, the distance shrinks from infinity.
 */
export function lookahead(input: LookInput): Map<WindowKey, Lookahead> {
  const edges = lookEdges(input);
  const keys = [...input.flow.steps.keys()];
  const any1 = new Map<StepKey, ReadonlySet<AssetId>>(keys.map((k) => [k, new Set()]));
  const d2 = new Map<StepKey, ReadonlySet<AssetId>>(keys.map((k) => [k, new Set()]));
  const d3 = new Map<StepKey, ReadonlySet<AssetId>>(keys.map((k) => [k, new Set()]));
  const all1 = new Map<StepKey, ReadonlySet<AssetId> | null>(keys.map((k) => [k, null])); // null: every file (not yet narrowed)
  const dist = new Map<StepKey, number>(keys.map((k) => [k, Number.POSITIVE_INFINITY]));
  const none: ReadonlySet<AssetId> = new Set();
  for (let changed = true; changed; ) {
    changed = false;
    for (const k of keys) {
      const out = edges.get(k) ?? [];
      const nAny = new Set<AssetId>();
      const nD2 = new Set<AssetId>();
      const nD3 = new Set<AssetId>();
      let nAll = null as ReadonlySet<AssetId> | null; // null: every file (no edge seen yet); a cast keeps the loop from narrowing it
      let nDist = Number.POSITIVE_INFINITY;
      for (const e of out) {
        // An edge to no step (`to: null`: an end, a return to a room) has nothing after its own files.
        const after = (m: ReadonlyMap<StepKey, ReadonlySet<AssetId>>): ReadonlySet<AssetId> => (e.to === null ? none : (m.get(e.to) ?? none));
        const appeared = e.files.size > 0;
        for (const a of appeared ? e.files : after(any1)) {
          nAny.add(a);
        }
        for (const a of appeared ? after(any1) : after(d2)) {
          nD2.add(a);
        }
        for (const a of appeared ? after(d2) : after(d3)) {
          nD3.add(a);
        }
        // A path that ends with no appearance shares none; an unnarrowed successor (null) narrows nothing yet.
        const first = appeared ? e.files : e.to === null ? none : (all1.get(e.to) ?? null);
        nAll = nAll === null ? first : first === null ? nAll : new Set([...nAll].filter((a) => first.has(a)));
        nDist = Math.min(nDist, appeared ? 1 : e.to === null ? Number.POSITIVE_INFINITY : 1 + (dist.get(e.to) ?? Number.POSITIVE_INFINITY));
      }
      if (!sameSet(nAny, any1.get(k) ?? null) || !sameSet(nD2, d2.get(k) ?? null) || !sameSet(nD3, d3.get(k) ?? null) || !sameSet(nAll, all1.get(k) ?? null) || nDist !== dist.get(k)) {
        any1.set(k, nAny);
        d2.set(k, nD2);
        d3.set(k, nD3);
        all1.set(k, nAll);
        dist.set(k, nDist);
        changed = true;
      }
    }
  }
  const out = new Map<WindowKey, Lookahead>();
  for (const step of input.flow.steps.values()) {
    const k = step.key;
    const certain = [...(all1.get(k) ?? none)].sort(order);
    const possible = [...(any1.get(k) ?? none)].filter((a) => !certain.includes(a)).sort(order);
    const cur = new Set(entryOf(step.effect, input).flat());
    for (const s of step.effect.shots) {
      for (const a of shotFiles(s, step.effect, input.files, true)) {
        cur.add(a);
      }
    }
    out.set(k, {
      cur: [...cur].sort(order),
      certain,
      certainDist: certain.length > 0 ? (dist.get(k) ?? 0) : 0,
      possible,
      near: possible.length,
      d2: [...(d2.get(k) ?? none)].sort(order),
      d3: [...(d3.get(k) ?? none)].sort(order),
      labels: [...step.effect.room].some((r) => r !== null),
    });
  }
  // A room window (§3.4 "At an explore yield"): nothing certain; the openers of its own knots, then of its neighbours'.
  const opens = (knots: readonly KnotName[]): AssetId[] => [...new Set(knots.flatMap((k) => [...(any1.get(knotKey(k)) ?? none)]))].sort(order);
  for (const [r, ev] of input.rooms) {
    const near = opens(ev.near);
    const far = opens(ev.far).filter((a) => !near.includes(a));
    out.set(`r:${r}`, { cur: roomFiles(r, input, true), certain: [], certainDist: 0, possible: [...near, ...far], near: near.length, d2: [], d3: [], labels: true });
  }
  return out;
}

/**
 * The entry alternatives of every window (§3.4, D9): a step's per `entryOf`; a room window's one alternative, its shot
 * at rest and its pictures (a resume into the explore restores any room of the section).
 */
export function entries(input: LookInput): Map<WindowKey, AssetId[][]> {
  const out = new Map<WindowKey, AssetId[][]>();
  for (const step of input.flow.steps.values()) {
    out.set(step.key, entryOf(step.effect, input));
  }
  for (const r of input.rooms.keys()) {
    out.set(`r:${r}`, [roomFiles(r, input, false)]);
  }
  return out;
}
