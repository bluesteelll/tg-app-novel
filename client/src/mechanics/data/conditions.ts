// The condition grammar (engine plan §4): one JSON form for every condition a world writes (a clue, a gating `when`, a
// visual `is`), decoded here with every issue as a value, its facts listed for the section key and the lints, its
// size measured for `world/cond-size`. The evaluator is the chunk's (mechanics/rules/conditions.ts). Engine half: pure,
// with no top-level call, so a bundle that never decodes a condition drops this module.
import type { Result } from '../../story/catalog.ts';
import type { PuzzleLocalId } from '../../story/staging.ts';
import type { DocId, HotspotKey, ItemId, RoomId } from '../../world/types.ts';
import type { DecodeCtx, FactAtom, FactKind, Issue, IssueReport } from '../contract.ts';
import { MECHANIC_DATA } from './index.ts';
import type { DataRegistry } from './index.ts';

/** A condition: exactly one key. `null` ("always") is the site's, never a Cond. */
export type Cond =
  | { readonly held: ItemId }
  | { readonly used: ItemId }
  /** held or used */
  | { readonly has: ItemId }
  | { readonly doc: DocId }
  | { readonly taken: HotspotKey }
  | { readonly examined: HotspotKey }
  | { readonly open: HotspotKey }
  | { readonly visited: RoomId }
  | { readonly solved: PuzzleLocalId }
  | { readonly failed: PuzzleLocalId }
  /** A module's atom (a data module declares it in `atoms`): `flag` (GM5f), `part` (GM8i, visual only). */
  | { readonly [moduleAtom: string]: unknown }
  | { readonly all: readonly Cond[] }
  | { readonly any: readonly Cond[] }
  | { readonly not: Cond };

/** LIMIT: a condition nests at most this deep (an atom is 1, a combinator 1 + its deepest member). */
export const COND_MAX_DEPTH = 4;
/** LIMIT: a condition holds at most this many atoms. */
export const COND_MAX_ATOMS = 16;

// The id patterns of world/decode.ts, which keeps its own private (PUZZLES-PLAN "Identifiers").
const ID_RE = /^[a-z][a-z0-9_]*$/;
const HOTSPOT_KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
/** Each kernel atom with the pattern of the id it names. */
const KERNEL_ATOMS: Readonly<Record<string, RegExp>> = {
  held: ID_RE,
  used: ID_RE,
  has: ID_RE,
  doc: ID_RE,
  taken: HOTSPOT_KEY_RE,
  examined: HOTSPOT_KEY_RE,
  open: HOTSPOT_KEY_RE,
  visited: ID_RE,
  solved: ID_RE,
  failed: ID_RE,
};
const COMBINATORS = ['all', 'any', 'not'];

/** A decoder in the kernel's shape: undefined exactly when it reported an issue. */
type Decoder = (v: unknown, path: string, report: IssueReport) => unknown;

function isObject(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function at(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}

/** A decoded condition's one key and its value. */
export function condEntry(c: Cond): readonly [string, unknown] {
  const [kind = ''] = Object.keys(c);
  // A Cond is a one-key object (the decoder admits nothing else): its key is read generically, never narrowed with `in`,
  // which the module-atom member defeats.
  return [kind, (c as Readonly<Record<string, unknown>>)[kind]];
}

/** The atoms the registry's modules declare, by kind. */
function moduleAtoms(mechanics: DataRegistry): ReadonlyMap<string, Decoder> {
  const out = new Map<string, Decoder>();
  for (const m of mechanics) {
    for (const [kind, atom] of Object.entries(m.atoms ?? {})) {
      out.set(kind, atom.decode);
    }
  }
  return out;
}

function cond(v: unknown, path: string, report: IssueReport, atoms: ReadonlyMap<string, Decoder>): Cond | undefined {
  const keys = isObject(v) ? Object.keys(v) : [];
  const [kind] = keys;
  if (!isObject(v) || keys.length !== 1 || kind === undefined || !(Object.hasOwn(KERNEL_ATOMS, kind) || COMBINATORS.includes(kind) || atoms.has(kind))) {
    const kinds = [...Object.keys(KERNEL_ATOMS), ...COMBINATORS, ...atoms.keys()].join(', ');
    report(path, 'shape', `${JSON.stringify(v) ?? 'undefined'} is not an object with exactly one key of ${kinds}`);
    return undefined;
  }
  const value = v[kind];
  const p = at(path, kind);
  if (kind === 'not') {
    const inner = cond(value, p, report, atoms);
    return inner === undefined ? undefined : { not: inner };
  }
  if (kind === 'all' || kind === 'any') {
    if (!Array.isArray(value)) {
      report(p, 'shape', 'not an array of conditions');
      return undefined;
    }
    if (value.length === 0) {
      // One spelling per meaning: `all: []` is null, and `any: []` would never hold.
      report(p, 'shape', 'an empty list: write null for always');
      return undefined;
    }
    const members = value.map((m: unknown, i) => cond(m, at(p, i), report, atoms));
    return members.every((m) => m !== undefined) ? { [kind]: members } : undefined;
  }
  const decode = atoms.get(kind);
  if (decode !== undefined) {
    const atom = decode(value, p, report);
    return atom === undefined ? undefined : { [kind]: atom };
  }
  const re = KERNEL_ATOMS[kind];
  if (typeof value !== 'string' || re === undefined || !re.test(value)) {
    report(p, 'id', `${JSON.stringify(value) ?? 'undefined'} does not match ${re?.source ?? ''}`);
    return undefined;
  }
  return { [kind]: value };
}

/**
 * Decodes one condition at `path`: strict keys, every issue in one pass, in the kernel's reasons and paths (`shape` at
 * the condition, `id` at `<path>.<kind>`); a module's atom through its declared decoder (`mechanics`: the registry the
 * world is decoded with). The depth and atom caps are `world/cond-size`'s, not the decoder's. `_ctx` is the composed
 * decoder's context, passed by a module that decodes a condition: no atom reads it yet.
 */
export function decodeCond(raw: unknown, _ctx: DecodeCtx, path: string, mechanics: DataRegistry = MECHANIC_DATA): Result<Cond, Issue[]> {
  const issues: Issue[] = [];
  const c = cond(raw, path, (p, reason, detail) => issues.push({ path: p, reason, detail }), moduleAtoms(mechanics));
  return c === undefined || issues.length > 0 ? { ok: false, error: issues } : { ok: true, value: c };
}

/**
 * Every fact the condition reads, in tree order (`not`'s members included): `has` reads `held` and `used`; a module's
 * atom reads the fact kind of its own name, its value as the id (JSON when it is not a string).
 */
export function condReads(c: Cond): readonly FactAtom[] {
  const [kind, value] = condEntry(c);
  if (kind === 'all' || kind === 'any') {
    return (value as readonly Cond[]).flatMap(condReads); // a decoded combinator holds its members
  }
  if (kind === 'not') {
    return condReads(value as Cond); // a decoded `not` holds one condition
  }
  const id = typeof value === 'string' ? value : JSON.stringify(value);
  // A kernel atom's kind is its fact kind; a module's atom names the fact kind its module declares (engine plan §4).
  return kind === 'has' ? [{ kind: 'held', id }, { kind: 'used', id }] : [{ kind: kind as FactKind, id }];
}

/** The condition's depth (an atom 1, a combinator 1 + its deepest member) and its number of atoms. */
export function condSize(c: Cond): { readonly depth: number; readonly atoms: number } {
  const [kind, value] = condEntry(c);
  if (kind !== 'all' && kind !== 'any' && kind !== 'not') {
    return { depth: 1, atoms: 1 };
  }
  const members = kind === 'not' ? [value as Cond] : (value as readonly Cond[]); // a decoded combinator's members
  const sizes = members.map(condSize);
  return { depth: 1 + Math.max(...sizes.map((s) => s.depth)), atoms: sizes.reduce((n, s) => n + s.atoms, 0) };
}
