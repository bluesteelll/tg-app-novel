// Module `carry`'s build half (engine plan §6.6): the proof that a required item carried from chapter c to chapter r is
// held when r starts. Two lint entries with disjoint codes: the per-world pass over a receiver's own data
// (`world/inherit-count`, `world/inherit-item`), and a story-level entry whose rules run from scripts/story.ts over every
// chapter at once (story/items.json, the giver's paths, its leaves, what consumes a carried item, the tiers). Build only
// and pure, no node:*: world.ts imports the registry and scan-dist.ts imports world.ts. Its imports from index.ts and
// lint.ts are `import type`; it never imports `world.ts`, `graph.ts` or `softlock.ts` (index.ts's header): story.ts hands
// it the graph's facts as plain data, and softlock.ts reads its code table.
import { hotspotKey, lockOf } from '../../../src/explore/reduce.ts';
import type { KernelWorld } from '../../../src/mechanics/contract.ts';
import { ownScope } from '../../../src/mechanics/rules/search.ts';
import type { ChapterId, KnotName, SectionId } from '../../../src/story/staging.ts';
import { toPublic } from '../../../src/world/decode.ts';
import type { ItemId, RoomId, WorldSource } from '../../../src/world/types.ts';
import type { Finding, Severity } from '../lint.ts';
import type { WorldLint, WorldLintInput } from './index.ts';

/** The carried-item registry (engine plan §6.6): `[{ id, from }]`, each carried item's one giving chapter. Build input
 *  only: never emitted. */
export const ITEMS_FILE = 'story/items.json';

/** D2: at most this many optional inherited items per receiver, so each section proves at most 2^3 starts. */
export const MAX_OPTIONAL_INHERITS = 3;

/** The per-world codes: a receiver's own data. Each is a refusal. */
export const CARRY_CODES = {
  'world/inherit-count': 'E',
  'world/inherit-item': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
type CarryCode = keyof typeof CARRY_CODES;

/** The story-level codes (scripts/story.ts runs their rules over every chapter; softlock.ts raises `world/carry-leave`).
 *  Each is a refusal: a carry that does not hold would inject at r's start what play never gave. */
export const CARRY_PROOF_CODES = {
  'world/carry-registry': 'E',
  'world/carry-inherit': 'E',
  'world/carry-mark': 'E',
  'world/carry-required-path': 'E',
  'world/carry-giver-prefix': 'E',
  'world/carry-leave': 'E',
  'world/carry-consumed': 'E',
  'world/carry-tier': 'E',
} as const satisfies Readonly<Record<string, Severity>>;
export type CarryProofCode = keyof typeof CARRY_PROOF_CODES;

/**
 * A receiver's own data: more than MAX_OPTIONAL_INHERITS optional inherited items (`world/inherit-count`: its sections
 * are then not searched), and an inherited item it does not declare or that a section of it gives (`world/inherit-item`:
 * S's own items, `ownScope`, kernel and module gifts alike, are what `resetSection` drops, so a section's start would
 * lose the inherited item).
 */
export function carryFindings(input: WorldLintInput): Finding[] {
  const w = input.world;
  const d = w.mods.carry;
  if (d.inherits.length === 0) {
    return [];
  }
  const out: Finding[] = [];
  const report = (code: CarryCode, path: string, message: string): void => {
    out.push({ code, severity: CARRY_CODES[code], file: input.file, line: input.line(path), message });
  };
  const optional = d.inherits.filter((e) => !e.required).length;
  if (optional > MAX_OPTIONAL_INHERITS) {
    report('world/inherit-count', 'inherits', `${optional} optional inherited items: at most ${MAX_OPTIONAL_INHERITS}, each doubles the starts a section proves (§6.6)`);
  }
  const kw = { ...toPublic(w), mods: w.mods };
  const sections = Object.keys(w.sections) as SectionId[]; // the keys of a decoded world's sections
  d.inherits.forEach((e, n) => {
    const path = `inherits.${n}`;
    if (!Object.hasOwn(w.items, e.id)) {
      report('world/inherit-item', path, `item '${e.id}' is inherited but not declared in items: the receiver declares its texts (§6.6)`);
      return;
    }
    for (const s of sections.filter((x) => ownScope(kw, x).items.has(e.id))) {
      report('world/inherit-item', path, `item '${e.id}' is inherited and given in section ${s}: its reset would drop the inherited item (§6.6)`);
    }
  });
  return out;
}

export const CARRY_LINT: WorldLint<CarryCode> = { id: 'carry', codes: CARRY_CODES, lint: carryFindings };
export const CARRY_PROOF_LINT: WorldLint<CarryProofCode> = { id: 'carry-proof', codes: CARRY_PROOF_CODES, runsFrom: 'story' };

// ---------------------------------------------------------------------------------------------------------------
// The story-level pass (CARRY_PROOF_LINT's rules), over every listed chapter at once.

/**
 * One explore yield of a giver's section, as story.ts reads it off the chapter's graph: its knot and repo-relative place;
 * `prefix`: every entry of its knot reaches it (graph.ts `ExploreSite.prefix`); `exempt`: its knot is entered only as
 * the section's own event, so the section's search covers it.
 */
export type YieldSite = { readonly knot: KnotName; readonly file: string; readonly line: number; readonly prefix: boolean; readonly exempt: boolean };
/** A chapter's yields of one section, in source order, and the first continuing END its first knot reaches around all
 *  of them (null: none). */
export type SectionPath = { readonly sites: readonly YieldSite[]; readonly bypass: KnotName | null };
/** A listed chapter's world as the pass reads it: none, a file that did not decode (its `world/schema` fails the run),
 *  or the decoded source with its text. */
export type CarryWorld = { readonly kind: 'none' } | { readonly kind: 'invalid' } | { readonly kind: 'ok'; readonly source: WorldSource; readonly text: string };
/** One listed chapter, in list (play) order. */
export type CarryChapter = {
  readonly id: ChapterId;
  readonly paid: boolean;
  readonly next: ChapterId | null;
  readonly world: CarryWorld;
  /** Per section a yield of the chapter explores, its path (story.ts `carryPaths`); null: no path verdict, because the
   *  chapter did not compile or its entry names no knot (its own error says so). */
  readonly paths: ReadonlyMap<SectionId, SectionPath> | null;
};
/** The pass's input: the listed chapters and story/items.json as stored (null: absent, no rows). */
export type CarryInput = { readonly chapters: readonly CarryChapter[]; readonly registry: string | null };
/** A giver section to search again for its leaves (softlock.ts `checkSection`'s `required`): each required item it
 *  gives, with the first receiver (play order) that requires it. */
export type LeaveRun = { readonly chapter: ChapterId; readonly section: SectionId; readonly required: ReadonlyMap<ItemId, ChapterId> };

const ID_RE = /^[a-z][a-z0-9_]*$/;
const ROW_KEYS = ['id', 'from'];
const BOM = String.fromCharCode(0xfeff);

/**
 * The 1-based line of a dotted path in a JSON text that parses, else of its nearest written ancestor, else 0: the world
 * runner's line lookup (`world.ts`'s `pathLines` and `lineOf`, private there), restated so the story-level findings
 * carry the author's line; world.test.ts pins the two equal.
 */
export function carryLines(text: string): (path: string) => number {
  const lines = new Map<string, number>();
  let i = text.startsWith(BOM) ? 1 : 0;
  let line = 1;
  const child = (path: string, key: string | number): string => (path === '' ? String(key) : `${path}.${key}`);
  const blank = (): void => {
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') {
        line += 1;
      } else if (c !== ' ' && c !== '\t' && c !== '\r') {
        return;
      }
    }
  };
  const string = (): string => {
    const start = i;
    for (i += 1; i < text.length && text[i] !== '"'; i++) {
      if (text[i] === '\\') {
        i += 1;
      }
    }
    i += 1;
    return JSON.parse(text.slice(start, i)) as string; // a string token of a text JSON.parse accepted
  };
  const value = (path: string): void => {
    blank();
    const c = text[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i += 1;
      blank();
      for (let n = 0; text[i] !== close && i < text.length; n++) {
        blank();
        let at = child(path, n);
        if (c === '{') {
          const keyLine = line;
          at = child(path, string());
          lines.set(at, keyLine);
          blank();
          i += 1; // ':'
        } else {
          lines.set(at, line);
        }
        value(at);
        blank();
        if (text[i] === ',') {
          i += 1;
          blank();
        }
      }
      i += 1;
    } else if (c === '"') {
      string();
    } else {
      while (i < text.length && !/[\s,\]}]/.test(text[i] ?? '')) {
        i += 1;
      }
    }
  };
  value('');
  return (path) => {
    for (let p = path; p !== ''; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '') {
      const found = lines.get(p);
      if (found !== undefined) {
        return found;
      }
    }
    return 0;
  };
}

/**
 * What in world `w` consumes item `i`, each with its source path at the line naming the item: a kernel lock slot that
 * accepts it and does not keep it (`mods.use.keep` has no `<HotspotKey>#<slot index>`), a `uses` rule on it without
 * `keep`, and a recipe with it as an input outside its `keep`; in source order, slots and rules per hotspot first.
 */
function consumersOf(w: WorldSource, i: ItemId): Array<{ what: string; path: string }> {
  const out: Array<{ what: string; path: string }> = [];
  const kept = new Set(w.mods.use.keep);
  for (const [s, section] of Object.entries(w.sections)) {
    for (const [room, r] of Object.entries(section.rooms)) {
      r.hotspots.forEach((h, n) => {
        const key = hotspotKey(room as RoomId, h.id); // a decoded world's room key
        const at = `sections.${s}.rooms.${room}.hotspots.${n}`;
        lockOf(h)?.slots.forEach((slot, j) => {
          if (slot.accepts === i && !kept.has(`${key}#${j}`)) {
            out.push({ what: `slot ${key}#${j}`, path: `${at}.lock.slots.${j}.accepts` });
          }
        });
        (w.mods.use.uses[key] ?? []).forEach((rule, j) => {
          if (rule.item === i && !rule.keep) {
            out.push({ what: `rule ${j} of ${key}`, path: `${at}.uses.${j}.item` });
          }
        });
      });
    }
  }
  w.mods.combine.recipes.forEach((r, n) => {
    for (const side of ['a', 'b'] as const) {
      if (r[side] === i && !r.keep.includes(i)) {
        out.push({ what: `recipe ${n}`, path: `recipes.${n}.${side}` });
      }
    }
  });
  return out;
}

/** One registry row that passed its checks: the item's giving chapter and the row's index. */
type Row = { readonly from: ChapterId; readonly at: number };
type Report = (code: CarryProofCode, file: string, line: number, message: string) => void;

/**
 * story/items.json's rows by item id: null when the file is not a JSON array (one finding: nothing that needs rows is
 * judged). A row that is not exactly `{ id, from }` with an item id and a listed chapter, and every row of an id that
 * has more than one, is reported and left out, and its id goes to `broken`: what names it is not judged again (the
 * registry's error fails the run closed).
 */
function registryOf(text: string | null, listed: ReadonlySet<ChapterId>, report: Report): { rows: Map<ItemId, Row>; broken: Set<string> } | null {
  const rows = new Map<ItemId, Row>();
  const broken = new Set<string>();
  if (text === null) {
    return { rows, broken };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
  } catch (e) {
    report('world/carry-registry', ITEMS_FILE, 0, `not JSON: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (!Array.isArray(raw)) {
    report('world/carry-registry', ITEMS_FILE, 0, 'not an array of { id, from } rows (§6.6)');
    return null;
  }
  const line = carryLines(text);
  const seen = new Map<string, number>();
  raw.forEach((v: unknown, k) => {
    const say = (path: string, message: string): void => report('world/carry-registry', ITEMS_FILE, line(path), `${path}: ${message}`);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      say(`${k}`, 'not an { id, from } object');
      return;
    }
    const row = v as Readonly<Record<string, unknown>>; // an object, checked above
    let ok = true;
    for (const key of Object.keys(row).filter((x) => !ROW_KEYS.includes(x))) {
      say(`${k}.${key}`, 'unknown key (expected id, from)');
      ok = false;
    }
    const id = row['id'];
    const from = row['from'];
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      say(`${k}.id`, `not an item id ${ID_RE.source}`);
      return;
    }
    const first = seen.get(id);
    if (first !== undefined) {
      say(`${k}.id`, `item '${id}' has row ${first} too: one giving chapter per carried item`);
      rows.delete(id as ItemId); // an id by the pattern
      broken.add(id);
      return;
    }
    seen.set(id, k);
    if (typeof from !== 'string' || !listed.has(from as ChapterId)) {
      say(`${k}.from`, `${JSON.stringify(from) ?? 'missing'} is no listed chapter`);
      ok = false;
    }
    if (ok) {
      rows.set(id as ItemId, { from: from as ChapterId, at: k }); // an item id and a listed chapter, both checked above
    } else {
      broken.add(id);
    }
  });
  return { rows, broken };
}

/**
 * The story-level carry rules over every listed chapter (engine plan §6.6), each a refusal: story/items.json itself
 * (`world/carry-registry`, a row whose chapter gives its item in no section included); each receiver's inherited item
 * registered, from a chapter before it on its chain whose world marks it (`world/carry-inherit`), and never from a paid
 * chapter into a free one (`world/carry-tier`: the paid item would reach a free chapter's player); each mark registered,
 * at its giving chapter or at a chapter that inherits it (`world/carry-mark`); for each required item, its giver section
 * yielded and no continuing END reachable around that section's yields (`world/carry-required-path`), and each knot
 * holding such a yield reaching one of them on every entry (`world/carry-giver-prefix`: a path through the knot then
 * passes the yield); and no chapter of a receiver's chain from the giver through the receiver consuming a required item
 * (`world/carry-consumed`: it is injected at the receiver's start, so it must stay held all the way). Returns the
 * findings and, per giver section of a required item, the leave search story.ts runs (`world/carry-leave`). A mark with
 * a row and no receiver is no finding: a story may carry an item into a chapter not yet written.
 */
export function carryProof(input: CarryInput): { findings: Finding[]; leaves: LeaveRun[] } {
  const findings: Finding[] = [];
  const report: Report = (code, file, line, message) => {
    findings.push({ code, severity: CARRY_PROOF_CODES[code], file, line, message });
  };
  const byId = new Map(input.chapters.map((c) => [c.id, c]));
  const registry = registryOf(input.registry, new Set(byId.keys()), report);
  if (registry === null) {
    return { findings, leaves: [] };
  }
  const { rows, broken } = registry;
  // Each chapter's predecessor on its chain: the list is in play order and every chapter is on one chain.
  const before = new Map<ChapterId, ChapterId>();
  for (const c of input.chapters) {
    if (c.next !== null) {
      before.set(c.next, c.id);
    }
  }
  const earlier = (r: ChapterId): Set<ChapterId> => {
    const out = new Set<ChapterId>();
    for (let c = before.get(r); c !== undefined && !out.has(c); c = before.get(c)) {
      out.add(c);
    }
    return out;
  };
  const proofWorlds = new Map<ChapterId, KernelWorld>();
  /** The section of c's world that gives `i` (X15: one), first in key order; null: none, or c has no world. */
  const giverOf = (c: CarryChapter, i: ItemId): SectionId | null => {
    if (c.world.kind !== 'ok') {
      return null;
    }
    const kw = proofWorlds.get(c.id) ?? { ...toPublic(c.world.source), mods: c.world.source.mods };
    proofWorlds.set(c.id, kw);
    return (Object.keys(c.world.source.sections) as SectionId[]).sort().find((s) => ownScope(kw, s).items.has(i)) ?? null; // decoded section ids
  };
  const worldFile = (c: ChapterId): string => `story/${c}/world.json`;

  // The registry's rows against their giving chapters: the giver gives the item in some section of its world.
  const registryLine = carryLines(input.registry ?? '[]');
  for (const [i, row] of [...rows]) {
    const c = byId.get(row.from);
    if (c !== undefined && c.world.kind !== 'invalid' && giverOf(c, i) === null) {
      report('world/carry-registry', ITEMS_FILE, registryLine(`${row.at}`), `${row.at}: chapter ${c.id} gives item '${i}' in no section of its world (§6.6)`);
      rows.delete(i);
      broken.add(i);
    }
  }

  // Each receiver's inherited items, in list order; each required one's (giver, item) once, with its first receiver;
  // and every (giver, item, receiver) of a required one, for the consumed check.
  const required = new Map<string, { from: CarryChapter; item: ItemId; receiver: ChapterId }>();
  const held: Array<{ from: ChapterId; item: ItemId; receiver: ChapterId }> = [];
  for (const r of input.chapters) {
    if (r.world.kind !== 'ok') {
      continue;
    }
    const line = carryLines(r.world.text);
    const prior = earlier(r.id);
    r.world.source.mods.carry.inherits.forEach((e, n) => {
      const refuse = (message: string): void => report('world/carry-inherit', worldFile(r.id), line(`inherits.${n}`), `item '${e.id}': ${message} (§6.6)`);
      const row = rows.get(e.id);
      const from = row === undefined ? undefined : byId.get(row.from);
      if (broken.has(e.id)) {
        return; // its row is the registry's error
      }
      if (from === undefined) {
        refuse(`${r.id} inherits it, but ${ITEMS_FILE} has no row for it`);
      } else if (!prior.has(from.id)) {
        refuse(from.id === r.id ? `${ITEMS_FILE} gives it from ${r.id} itself` : `it comes from ${from.id}, which is not before ${r.id} on its chain`);
      } else if (from.world.kind === 'ok' && !from.world.source.mods.carry.marks.includes(e.id)) {
        refuse(`${from.id}'s world does not mark it carry: true`);
      } else {
        // Tiers from story/chapters.json: free -> paid, paid -> paid and free -> free are fine.
        if (from.paid && !r.paid) {
          const message = `item '${e.id}' comes from ${from.id}, a paid chapter, into ${r.id}, a free one: a paid chapter's item would reach a free chapter's player (§6.6)`;
          report('world/carry-tier', worldFile(r.id), line(`inherits.${n}`), message);
        }
        if (e.required && from.world.kind === 'ok') {
          held.push({ from: from.id, item: e.id, receiver: r.id });
          if (!required.has(`${from.id}.${e.id}`)) {
            required.set(`${from.id}.${e.id}`, { from, item: e.id, receiver: r.id });
          }
        }
      }
    });
  }

  // Each required item, from its giver through each receiver of it: no chapter on the way consumes it (the giver and
  // the receiver included). One finding per consumer, however many receivers' chains pass it.
  const consumed = new Set<string>();
  for (const { from, item, receiver } of held) {
    const chain: ChapterId[] = [receiver];
    for (let c = before.get(receiver); c !== undefined && chain.at(-1) !== from; c = before.get(c)) {
      chain.push(c); // `from` is earlier on the receiver's chain (checked above), so the walk ends there
    }
    for (const c of chain.reverse()) {
      const w = byId.get(c)?.world;
      if (w?.kind !== 'ok') {
        continue;
      }
      const line = carryLines(w.text);
      for (const { what, path } of consumersOf(w.source, item)) {
        const message = `item '${item}' is inherited as required from ${from}, but ${what} consumes it: a required carried item stays held from its giver through its receiver (§6.6)`;
        const at = `${worldFile(c)}:${line(path)}:${message}`;
        if (!consumed.has(at)) {
          consumed.add(at);
          report('world/carry-consumed', worldFile(c), line(path), message);
        }
      }
    }
  }

  // Each mark: registered, and at its giving chapter or at a chapter that inherits it (a chain item's re-mark).
  for (const c of input.chapters) {
    if (c.world.kind !== 'ok') {
      continue;
    }
    const line = carryLines(c.world.text);
    const inherited = new Set(c.world.source.mods.carry.inherits.map((e) => e.id));
    for (const i of c.world.source.mods.carry.marks) {
      const refuse = (message: string): void => report('world/carry-mark', worldFile(c.id), line(`items.${i}.carry`), `item '${i}' is marked carry: true, but ${message} (§6.6)`);
      const row = rows.get(i);
      if (broken.has(i)) {
        continue; // its row is the registry's error
      }
      if (row === undefined) {
        refuse(`${ITEMS_FILE} has no row for it`);
      } else if (row.from !== c.id && !inherited.has(i)) {
        refuse(`${ITEMS_FILE} gives it from ${row.from} and ${c.id} does not inherit it`);
      }
    }
  }

  // Each required item's giver section: yielded, and every continuing END behind one of its yields.
  const leaves = new Map<string, { chapter: ChapterId; section: SectionId; required: Map<ItemId, ChapterId> }>();
  for (const { from, item, receiver } of required.values()) {
    const g = giverOf(from, item);
    if (g === null || from.world.kind !== 'ok') {
      continue; // a row whose chapter gives its item in no section is the registry's error
    }
    const run = leaves.get(`${from.id}.${g}`) ?? { chapter: from.id, section: g, required: new Map<ItemId, ChapterId>() };
    run.required.set(item, receiver);
    leaves.set(`${from.id}.${g}`, run);
    if (from.paths === null) {
      continue;
    }
    const why = `section ${g} gives item '${item}', which ${receiver} inherits as required`;
    const path = from.paths.get(g);
    const first = path?.sites[0];
    if (path === undefined || first === undefined) {
      report('world/carry-required-path', worldFile(from.id), carryLines(from.world.text)(`sections.${g}`), `${why}, but no explore yield of ${from.id} enters it (§6.6)`);
    } else if (path.bypass !== null) {
      report('world/carry-required-path', first.file, first.line, `${why}, but the END of knot '${path.bypass}' is reachable without a yield of ${g} (§6.6)`);
    }
    // Per knot, its first yield of G on every entry (the first such yield runs; later ones are irrelevant).
    for (const knot of new Set(path?.sites.map((x) => x.knot) ?? [])) {
      const own = path?.sites.filter((x) => x.knot === knot) ?? [];
      const head = own[0];
      if (head !== undefined && !own.some((x) => x.prefix || x.exempt)) {
        const where = `the yield of ${g} in knot '${knot}' follows a choice not gathered, a divert, a thread, a stitch or an open block`;
        report('world/carry-giver-prefix', head.file, head.line, `${why}, but ${where}: an entry of the knot may never reach it (§6.6)`);
      }
    }
  }
  return { findings, leaves: [...leaves.values()] };
}
