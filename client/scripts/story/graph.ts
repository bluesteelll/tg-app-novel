// The knot graph of one compiled chapter (STAGING-DSL §8, §10; PROTOTYPE-PLAN.md K9): per knot the assets its
// literal tags name, its successor knots, whether it writes `-> END`, and the clears of its opening tag lines; then
// reachability (`graph/*`), variable diverts (`ink/forbidden`), the carried stage per knot (the `budget/knot-set`
// input) and the chapter's ID'd lines. From LW3 the yield edges (STAGING-DSL §8 "Yield edges"; PUZZLES-PLAN §8 knot
// index) and the yield codes against the chapter's world (`puzzle/*`, `explore/*`). Pure: no node:*, no inkjs; tags
// are read only through `parseTags`.
import { lockOf, worldIndex } from '../../src/explore/reduce.ts';
import type { AssetId, AssetIndex, ChapterId, CharId, KnotName, LineId, SectionId, StagingCommand, VarName, YieldCommand } from '../../src/story/staging.ts';
import { parseTags, tagKind } from '../../src/story/tags.ts';
import type { Room, WorldPublicBody } from '../../src/world/types.ts';
import { classify, openingTagLines, unescapeInk } from './classify.ts';
import type { Divert, LineClass, RawTag, SourceLine } from './classify.ts';
import { GLOBALS_PATH, LINT_CODES, tagsOf } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';
import type { VarLiteral } from './world.ts';

/** A player-facing line with its ID: `text` is as displayed (speaker prefix stripped, ink escapes resolved). */
export type StoryLine = { id: LineId; text: string; file: string; line: number };
/** What a knot's opening tag lines clear on every entry (STAGING-DSL §8 "What clears"). */
export type Clears = { all: boolean; bg: boolean; cg: boolean; chars: 'all' | readonly CharId[] };
export type KnotNode = {
  name: KnotName;
  /** Where the knot's header is. */
  file: string;
  line: number;
  /** Every asset its literal tags name (sorted); `hide`, `wait`, `cg: off` and `bgm: stop` name none. */
  assets: readonly AssetId[];
  /** Successor knots (sorted): every other or same knot a divert written inside it names, and a `then=` knot. */
  next: readonly KnotName[];
  /** A `-> END` is written inside it (STAGING-DSL §8). */
  ending: boolean;
  clears: Clears;
};
export type ChapterGraph = {
  chapter: ChapterId;
  /** The knot the entry's top-level divert names; null when it names none (a finding says why). */
  firstKnot: KnotName | null;
  /** Non-function knots in source order. */
  knots: ReadonlyMap<KnotName, KnotNode>;
  /** The carry set: the g_ VARs of common/globals.ink (sorted). */
  globals: readonly VarName[];
  /** Every VAR the chapter's files declare (sorted; CONST is not in variablesState). */
  vars: readonly VarName[];
  /** Every ID'd line and choice of the chapter's files, in file and source order. */
  lines: readonly StoryLine[];
  /** Per knot, the images a predecessor may leave on stage that the knot does not clear or name (sorted). */
  carried: ReadonlyMap<KnotName, readonly AssetId[]>;
};
/**
 * The chapter's world as the graph sees it: none (no world.json), invalid (it failed `world/schema`: the
 * world-dependent codes are skipped, so one broken file is not also one finding per tag), or its public body.
 */
export type WorldRef = { kind: 'none' } | { kind: 'invalid' } | { kind: 'ok'; body: WorldPublicBody };
/** What the world lint needs of a compiled chapter beyond its graph. */
export type GraphFacts = {
  /** Per knot, the yields its tags write, in source order. */
  yields: ReadonlyMap<KnotName, readonly YieldCommand[]>;
  /** Every VAR the chapter's files declare, with its declared value's literal type (`world/var-type`). */
  declared: ReadonlyMap<VarName, VarLiteral>;
};
/** An explore yield's section knots: reachability edges from the yielding knot, and their entry stage. */
type SectionEdges = { edges: ReadonlyMap<KnotName, readonly KnotName[]>; seeds: ReadonlyMap<KnotName, readonly AssetId[]> };

function finding(code: LintCode, file: string, line: number, message: string): Finding {
  return { code, severity: LINT_CODES[code], file, line, message };
}

/** The divert-bearing line classes (lint.ts `divertsOf`). */
function divertsOf(cls: LineClass): Divert[] {
  switch (cls.kind) {
    case 'text':
    case 'choice':
    case 'gather':
    case 'divert':
    case 'block-open':
    case 'block-branch':
    case 'block-close':
      return cls.diverts;
    default:
      return [];
  }
}

/** The commands of the line's literal tags, one tag at a time (dynamic tags and tag errors are the lint's). */
function commandsOf(tags: readonly RawTag[], assets: AssetIndex): StagingCommand[] {
  return tags.filter((t) => !t.text.includes('{')).flatMap((t) => parseTags([t.text], assets).commands);
}

/** The asset a command names, if any. */
function assetOf(c: StagingCommand): AssetId | null {
  // The brands are earned by parseTags, which accepts only ids the catalog lists.
  switch (c.kind) {
    case 'bg':
    case 'scene':
      return `bg/${c.bg}` as AssetId;
    case 'show':
      return `char/${c.char}/${c.expr}` as AssetId;
    case 'cg':
      return c.cg === null ? null : (`cg/${c.cg}` as AssetId);
    case 'bgm':
      return c.track === null ? null : (`bgm/${c.track}` as AssetId);
    case 'sfx':
      return `sfx/${c.sfx}` as AssetId;
    case 'hide':
    case 'wait':
    case 'puzzle':
    case 'explore':
      return null;
    default: {
      const unhandled: never = c;
      throw new Error(`invariant: unhandled command ${String(unhandled)}`);
    }
  }
}

/** The images a stage can hold: backgrounds, CGs, character sprites and a room's props (never audio). */
function isImage(a: AssetId): boolean {
  return a.startsWith('bg/') || a.startsWith('cg/') || a.startsWith('char/') || a.startsWith('prop/');
}

function clearsOf(opening: readonly SourceLine[], assets: AssetIndex): Clears {
  let all = false;
  let bg = false;
  let cg = false;
  let everyChar = false;
  const chars = new Set<CharId>();
  for (const l of opening) {
    for (const c of commandsOf(tagsOf(l.cls), assets)) {
      if (c.kind === 'scene') {
        all = true;
      } else if (c.kind === 'bg') {
        bg = true;
      } else if (c.kind === 'cg') {
        cg = true;
      } else if (c.kind === 'show') {
        chars.add(c.char);
      } else if (c.kind === 'hide') {
        if (c.char === 'all') {
          everyChar = true;
        } else {
          chars.add(c.char);
        }
      }
    }
  }
  return { all, bg, cg, chars: everyChar ? 'all' : [...chars].sort() };
}

/** `stage` after `c` ran: what the opening tag lines clear is gone. */
function cleared(stage: ReadonlySet<AssetId>, c: Clears): Set<AssetId> {
  if (c.all) {
    return new Set();
  }
  return new Set(
    [...stage].filter((a) => {
      if (a.startsWith('bg/') || a.startsWith('prop/')) {
        return !c.bg; // a `bg` or `scene` clears the props too (STAGING-DSL §8)
      }
      if (a.startsWith('cg/')) {
        return !c.cg;
      }
      if (a.startsWith('char/')) {
        const chars = c.chars;
        return chars !== 'all' && !chars.some((ch) => a.startsWith(`char/${ch}/`));
      }
      return true;
    }),
  );
}

/** Knots reachable from `first` over `next` and the section edges, in breadth-first order. */
function reachable(knots: ReadonlyMap<KnotName, KnotNode>, first: KnotName, edges?: ReadonlyMap<KnotName, readonly KnotName[]>): Set<KnotName> {
  const seen = new Set<KnotName>();
  const queue: KnotName[] = knots.has(first) ? [first] : [];
  for (let k = queue.shift(); k !== undefined; k = queue.shift()) {
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    queue.push(...[...(knots.get(k)?.next ?? []), ...(edges?.get(k) ?? [])].filter((n) => knots.has(n) && !seen.has(n)));
  }
  return seen;
}

/**
 * The carried stage per knot (PROTOTYPE-PLAN.md "Budgets", `budget/knot-set`), as a least fixed point over the
 * reachable graph: `exit(P) = (entry(P) − clear(P)) ∪ images(P)`; `entry(K) = ∪ exit(P)` over K's reachable
 * predecessors. The first knot is SEEDED with the empty stage, not pinned to it: a path back into it (a hub, a loop)
 * brings its predecessors' images along. `carried(K) = (entry(K) − clear(K)) − assets(K) − ∪ assets(next(K))`.
 * Only opening tag lines clear; every other tag only adds. Unreachable knots carry nothing.
 * A section knot (an event or leave knot of an explore yield) is reached over a section edge (`extra.edges`) and
 * SEEDED with the stage of the rooms that name it (`extra.seeds`): it runs over its room, whose batch opens with a
 * scene fade (PUZZLES-PLAN F7 step 1), so the yielding knot's stage never flows along that edge.
 */
export function carriedStage(knots: ReadonlyMap<KnotName, KnotNode>, first: KnotName, extra?: SectionEdges): Map<KnotName, AssetId[]> {
  const live = reachable(knots, first, extra?.edges);
  const preds = new Map<KnotName, KnotName[]>([...live].map((k) => [k, []]));
  for (const k of live) {
    for (const n of knots.get(k)?.next ?? []) {
      preds.get(n)?.push(k);
    }
  }
  const entry = new Map<KnotName, Set<AssetId>>([...live].map((k) => [k, new Set(extra?.seeds.get(k) ?? [])]));
  const exit = (k: KnotName): Set<AssetId> => {
    const node = knots.get(k);
    if (node === undefined) {
      return new Set();
    }
    const out = cleared(entry.get(k) ?? new Set(), node.clears);
    for (const a of node.assets.filter(isImage)) {
      out.add(a);
    }
    return out;
  };
  // Monotone: entries only grow and exits grow with them, so the loop ends once a full sweep adds nothing.
  for (let changed = true; changed; ) {
    changed = false;
    for (const k of live) {
      const into = entry.get(k) ?? new Set();
      for (const p of preds.get(k) ?? []) {
        for (const a of exit(p)) {
          if (!into.has(a)) {
            into.add(a);
            changed = true;
          }
        }
      }
    }
  }
  const out = new Map<KnotName, AssetId[]>();
  for (const [name, node] of knots) {
    if (!live.has(name)) {
      out.set(name, []);
      continue;
    }
    const named = new Set<AssetId>([...node.assets, ...node.next.flatMap((n) => knots.get(n)?.assets ?? [])]);
    out.set(name, [...cleared(entry.get(name) ?? new Set(), node.clears)].filter((a) => !named.has(a)).sort());
  }
  return out;
}

/** The text and own tags of a text-bearing line or a choice with text (lint.ts `placedIds`), else null. */
function shown(cls: LineClass): { text: string; tags: readonly RawTag[] } | null {
  switch (cls.kind) {
    case 'text':
    case 'gather':
    case 'block-open':
    case 'block-branch':
    case 'block-close':
      return cls.text !== '' || cls.speaker !== null ? { text: cls.text, tags: cls.tags } : null;
    case 'choice': {
      const text = [cls.bracket?.text ?? '', cls.outside].filter((s) => s !== '').join(' ');
      return text === '' ? null : { text, tags: cls.bracket === null ? cls.afterTags : cls.bracket.tags };
    }
    default:
      return null;
  }
}

type Scope = { file: string; line: number; stitches: Set<string>; labels: Map<string | null, Set<string>> };
type Target = { kind: 'end' | 'none' | 'intra' | 'variable' } | { kind: 'knot'; knot: KnotName; below: boolean };

/** Where `-> target`, written in knot `knot` (null at top level) and stitch `stitch`, leads (STAGING-DSL §10). */
function resolveDivert(
  target: string,
  knot: string | null,
  stitch: string | null,
  scopes: ReadonlyMap<string, Scope>,
  variables: ReadonlySet<string>,
): Target {
  if (target === 'END') {
    return { kind: 'end' };
  }
  if (target === 'DONE' || target === '->') {
    return { kind: 'none' }; // `ink/forbidden` from the lint
  }
  const [head = '', ...rest] = target.split('.');
  const scope = knot === null ? undefined : scopes.get(knot);
  const label = (set: ReadonlySet<string> | undefined): boolean => set?.has(head) ?? false;
  if (rest.length === 0) {
    if (scope !== undefined && (label(scope.labels.get(stitch)) || label(scope.labels.get(null)) || scope.stitches.has(head))) {
      return { kind: 'intra' };
    }
    if (scopes.has(head)) {
      return { kind: 'knot', knot: head as KnotName, below: false }; // a knot name, indexed in pass 1
    }
    return { kind: variables.has(head) ? 'variable' : 'none' };
  }
  if (scope !== undefined && (head === knot || scope.stitches.has(head) || [...scope.labels.values()].some(label))) {
    return { kind: 'intra' };
  }
  // A non-knot head is the compiler's "Divert target not found".
  return scopes.has(head) ? { kind: 'knot', knot: head as KnotName, below: true } : { kind: 'none' };
}

type Parsed = { file: string; lines: readonly SourceLine[] };

/** The literal type of a VAR declaration's value (classify.ts `decl.value`). */
function varLiteral(value: string): VarLiteral {
  if (/^-?[0-9]+$/.test(value)) {
    return 'int';
  }
  if (/^-?[0-9]+\.[0-9]+$/.test(value)) {
    return 'float';
  }
  if (value === 'true' || value === 'false') {
    return 'bool';
  }
  return /^"(?:[^"\\]|\\.)*"$/.test(value) ? 'string' : 'other';
}

/** A section's knots: its event knots (named by a `story` effect of its rooms) and its leave knots, each with its rooms. */
type SectionKnots = { events: Map<KnotName, Room[]>; leaves: Map<KnotName, Room[]> };

function sectionKnots(body: WorldPublicBody, section: SectionId): SectionKnots {
  const out: SectionKnots = { events: new Map(), leaves: new Map() };
  const name = (into: Map<KnotName, Room[]>, knot: KnotName, room: Room): void => {
    const rooms = into.get(knot) ?? [];
    into.set(knot, rooms.includes(room) ? rooms : [...rooms, room]);
  };
  const s = Object.hasOwn(body.sections, section) ? body.sections[section] : undefined;
  for (const room of Object.values(s?.rooms ?? {})) {
    const effects = [...room.onEnter];
    for (const h of room.hotspots) {
      if (h.kind !== 'exit') {
        effects.push(...h.then);
      } else if ('story' in h.to) {
        name(out.leaves, h.to.story, room);
      }
      const lock = lockOf(h);
      effects.push(...(lock?.onOpen ?? []), ...(lock?.onFail ?? []));
    }
    for (const e of effects) {
      if ('story' in e) {
        name(out.events, e.story, room);
      }
    }
  }
  return out;
}

/** The images on stage over a room: its background and the props of its hotspots (taken ones included). */
function roomStage(room: Room): AssetId[] {
  const props = room.hotspots.flatMap((h) => ((h.kind === 'take' || h.kind === 'object') && h.prop !== null ? [`prop/${h.prop}` as AssetId] : []));
  return [`bg/${room.bg}` as AssetId, ...props]; // ids the world decoder checked; the catalog is world/unknown-asset's
}

/**
 * The knot graph of one chapter from the files its compile loaded (`CompiledChapter.files`, entry first). Reports
 * `graph/unreachable-knot`, `graph/no-end`, `graph/entry-below-top`, `ink/forbidden` (a divert to a variable),
 * `ink/entry` (the entry divert names no knot), and the yield codes against `world` (default none): `puzzle/unknown`,
 * `puzzle/then-unknown`, `puzzle/in-section`, `explore/unknown-section`, `explore/event-return`,
 * `explore/event-escape`. A `then=` knot is a successor; an explore yield's section knots are reachability edges only
 * (never in the preload `next`, PUZZLES-PLAN §8), seeded with their rooms' stage.
 */
export function buildGraph(input: {
  chapter: SourceChapter;
  files: readonly string[];
  sources: ReadonlyMap<string, string>;
  assets: AssetIndex;
  world?: WorldRef;
}): { graph: ChapterGraph; findings: Finding[]; facts: GraphFacts } {
  const { chapter, assets } = input;
  const world: WorldRef = input.world ?? { kind: 'none' };
  const parsed: Parsed[] = input.files.map((file) => ({ file, lines: classify(input.sources.get(file) ?? '') }));
  const findings: Finding[] = [];

  // Pass 1: knots (the first definition of a name wins; a repeat is the compiler's error), their stitches and
  // labels, and every name a divert could reach as a variable.
  const scopes = new Map<string, Scope>();
  const variables = new Set<string>();
  const vars = new Set<VarName>();
  const declared = new Map<VarName, VarLiteral>();
  const globals = new Set<VarName>();
  for (const { file, lines } of parsed) {
    let scope: Scope | null = null;
    for (const l of lines) {
      const cls = l.cls;
      if (cls.kind === 'knot') {
        scope = cls.fn || scopes.has(cls.name) ? null : { file, line: l.line, stitches: new Set(), labels: new Map() };
        if (scope !== null) {
          scopes.set(cls.name, scope);
        }
      } else if (cls.kind === 'stitch') {
        scope?.stitches.add(cls.name);
      } else if ((cls.kind === 'choice' || cls.kind === 'gather') && cls.label !== null && scope !== null) {
        const set = scope.labels.get(l.stitch) ?? new Set<string>();
        set.add(cls.label);
        scope.labels.set(l.stitch, set);
      } else if (cls.kind === 'decl' && (cls.keyword === 'VAR' || cls.keyword === 'CONST')) {
        variables.add(cls.name);
        if (cls.keyword === 'VAR') {
          vars.add(cls.name as VarName); // a declared name: the compile accepted it
          if (!declared.has(cls.name as VarName)) {
            declared.set(cls.name as VarName, varLiteral(cls.value)); // the same declared name
          }
          if (file === GLOBALS_PATH && cls.name.startsWith('g_')) {
            globals.add(cls.name as VarName);
          }
        }
      } else if (cls.kind === 'logic') {
        const temp = /^temp\s+([\p{L}\p{N}_]+)/u.exec(cls.code)?.[1];
        if (temp !== undefined) {
          variables.add(temp);
        }
      }
    }
  }

  // Pass 2: per knot its assets, successors, ending; the entry divert; the ID'd lines.
  const built = new Map<string, { assets: Set<AssetId>; next: Set<KnotName>; ending: boolean }>(
    [...scopes.keys()].map((k) => [k, { assets: new Set(), next: new Set(), ending: false }]),
  );
  const lines: StoryLine[] = [];
  const sites: { knot: KnotName | null; file: string; line: number; cmd: YieldCommand }[] = [];
  let entryDivert: { line: number; target: string; resolved: Target } | null = null;
  for (const { file, lines: source } of parsed) {
    // The knot whose body this line is in: null at top level, inside a function, and inside a repeated definition.
    let knot: string | null = null;
    for (const l of source) {
      const cls = l.cls;
      if (cls.kind === 'knot') {
        const scope = scopes.get(cls.name);
        knot = !cls.fn && scope?.file === file && scope.line === l.line ? cls.name : null;
      }
      const node = knot === null ? undefined : built.get(knot);
      const commands = commandsOf(tagsOf(cls), assets);
      for (const a of commands.map(assetOf)) {
        if (a !== null) {
          node?.assets.add(a);
        }
      }
      if (node === undefined && l.knot !== null) {
        continue; // a function body or a repeated definition: no successors, no ID'd lines of a knot
      }
      for (const c of commands) {
        if (c.kind === 'puzzle' || c.kind === 'explore') {
          sites.push({ knot: knot as KnotName | null, file, line: l.line, cmd: c }); // a compiled knot name, as above
        }
      }
      for (const d of divertsOf(cls)) {
        const resolved = resolveDivert(d.target, knot, l.stitch, scopes, variables);
        if (resolved.kind === 'variable') {
          findings.push(finding('ink/forbidden', file, l.line, `'-> ${d.target}' diverts to a variable: diverts name knots (§10)`));
        } else if (resolved.kind === 'end' && node !== undefined) {
          node.ending = true;
        } else if (resolved.kind === 'knot') {
          node?.next.add(resolved.knot);
          if (resolved.below) {
            const why = `enters knot '${resolved.knot}' below its top, past its opening tag lines`;
            findings.push(finding('graph/entry-below-top', file, l.line, `'-> ${d.target}' ${why}: divert to the knot itself (§10)`));
          }
        }
        if (node === undefined && file === chapter.entry && cls.kind === 'divert' && entryDivert === null) {
          entryDivert = { line: l.line, target: d.target, resolved };
        }
      }
      const s = shown(cls);
      const id = s === null ? null : parseTags(s.tags.filter((t) => tagKind(t.text) === 'id').map((t) => t.text), assets).lineId;
      if (s !== null && id !== null) {
        lines.push({ id, text: unescapeInk(s.text), file, line: l.line });
      }
    }
  }

  // The yields (STAGING-DSL §6, §8 "Yield edges"). A `then=` knot is a successor whatever the world; the
  // world-dependent codes are skipped for a world that failed `world/schema` (D6).
  const worldFile = `story/${chapter.id}/world.json`;
  const body = world.kind === 'ok' ? world.body : null;
  const index = body === null ? null : worldIndex(body);
  const yields = new Map<KnotName, YieldCommand[]>();
  const sectionsOf = new Map<SectionId, SectionKnots>();
  const knotsOf = (section: SectionId): SectionKnots => {
    const known = sectionsOf.get(section);
    const out = known ?? (body === null ? { events: new Map(), leaves: new Map() } : sectionKnots(body, section));
    sectionsOf.set(section, out);
    return out;
  };
  const edges = new Map<KnotName, Set<KnotName>>();
  const seeds = new Map<KnotName, Set<AssetId>>();
  for (const { knot, file, line, cmd } of sites) {
    if (knot !== null) {
      yields.set(knot, [...(yields.get(knot) ?? []), cmd]);
    }
    if (cmd.kind === 'puzzle') {
      if (scopes.has(cmd.then)) {
        if (knot !== null) {
          built.get(knot)?.next.add(cmd.then);
        }
      } else {
        findings.push(finding('puzzle/then-unknown', file, line, `'then=${cmd.then}' names no knot of ${chapter.id}`));
      }
      if (world.kind === 'none') {
        findings.push(finding('puzzle/unknown', file, line, `puzzle '${cmd.puzzle}': ${chapter.id} has no world (${worldFile})`));
      } else if (index !== null && !index.puzzles.has(cmd.puzzle)) {
        findings.push(finding('puzzle/unknown', file, line, `puzzle '${cmd.puzzle}' is not in ${worldFile}`));
      } else {
        const lock = index?.puzzleLock.get(cmd.puzzle);
        if (lock !== undefined) {
          const why = `is yielded here and is the puzzle of lock ${lock}: a lock's puzzle opens from its room (PUZZLES-PLAN §8)`;
          findings.push(finding('puzzle/in-section', file, line, `puzzle '${cmd.puzzle}' ${why}`));
        }
      }
      continue;
    }
    if (world.kind === 'none') {
      findings.push(finding('explore/unknown-section', file, line, `explore '${cmd.section}': ${chapter.id} has no world (${worldFile})`));
    } else if (index !== null && !index.sections.has(cmd.section)) {
      findings.push(finding('explore/unknown-section', file, line, `section '${cmd.section}' is not in ${worldFile}`));
    } else if (index !== null && knot !== null) {
      const { events, leaves } = knotsOf(cmd.section);
      for (const [k, rooms] of [...events, ...leaves]) {
        if (!scopes.has(k)) {
          continue; // a knot the chapter lacks: `world/unknown-ref`
        }
        edges.set(knot, (edges.get(knot) ?? new Set()).add(k));
        const seed = seeds.get(k) ?? new Set<AssetId>();
        for (const a of rooms.flatMap(roomStage)) {
          seed.add(a);
        }
        seeds.set(k, seed);
      }
    }
  }

  const knots = new Map<KnotName, KnotNode>();
  for (const [name, scope] of scopes) {
    const b = built.get(name);
    const file = parsed.find((p) => p.file === scope.file);
    const opening = file === undefined ? undefined : openingTagLines(file.lines).get(name);
    knots.set(name as KnotName, {
      name: name as KnotName, // a compiled knot name
      file: scope.file,
      line: scope.line,
      assets: [...(b?.assets ?? [])].sort(),
      next: [...(b?.next ?? [])].sort(),
      ending: b?.ending ?? false,
      clears: clearsOf(opening ?? [], assets),
    });
  }

  const ed = entryDivert;
  const firstKnot = ed?.resolved.kind === 'knot' ? ed.resolved.knot : null;
  if (ed !== null && firstKnot === null) {
    findings.push(finding('ink/entry', chapter.entry, ed.line, `'-> ${ed.target}' names no knot: the entry diverts to the first knot (§9)`));
  }

  // Event knots (D7): every event knot of every section, judged against its section's other event knots.
  for (const s of body === null ? [] : Object.keys(body.sections)) {
    const section = s as SectionId; // a decoded section id
    const events = knotsOf(section).events;
    for (const e of events.keys()) {
      const node = knots.get(e);
      if (node === undefined) {
        continue; // `world/unknown-ref`
      }
      const where = `event knot '${e}' of section ${section}`;
      if (node.ending) {
        findings.push(finding('explore/event-escape', node.file, node.line, `${where} writes '-> END': it returns with '# explore: ${section}' (§6)`));
      }
      for (const n of node.next.filter((k) => !events.has(k))) {
        findings.push(finding('explore/event-escape', node.file, node.line, `${where} leads to '${n}', which is not an event knot of ${section} (§6)`));
      }
      const closure = reachable(new Map([...knots].filter(([k]) => events.has(k))), e);
      const returns = [...closure].some((k) => (yields.get(k) ?? []).some((y) => y.kind === 'explore' && y.section === section));
      if (!returns) {
        findings.push(finding('explore/event-return', node.file, node.line, `${where} never yields '# explore: ${section}' back to the rooms (§6)`));
      }
    }
  }

  const sectionEdges: SectionEdges = {
    edges: new Map([...edges].map(([k, v]) => [k, [...v].sort()])),
    seeds: new Map([...seeds].map(([k, v]) => [k, [...v].sort()])),
  };
  const carried =
    firstKnot === null ? new Map<KnotName, AssetId[]>([...knots.keys()].map((k) => [k, []])) : carriedStage(knots, firstKnot, sectionEdges);
  if (firstKnot !== null && ed !== null) {
    const live = reachable(knots, firstKnot, sectionEdges.edges);
    for (const node of knots.values()) {
      if (!live.has(node.name)) {
        findings.push(finding('graph/unreachable-knot', node.file, node.line, `knot '${node.name}' is not reachable from '-> ${firstKnot}'`));
      }
    }
    if (![...live].some((k) => knots.get(k)?.ending === true)) {
      findings.push(finding('graph/no-end', chapter.entry, ed.line, `no knot reachable from '-> ${firstKnot}' writes '-> END' (§9)`));
    }
  }

  const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  findings.sort((a, b) => order(a.file, b.file) || a.line - b.line || order(a.code, b.code) || order(a.message, b.message));
  return {
    graph: {
      chapter: chapter.id,
      firstKnot,
      knots,
      globals: [...globals].sort(),
      vars: [...vars].sort(),
      lines,
      carried,
    },
    findings,
    facts: { yields, declared },
  };
}
