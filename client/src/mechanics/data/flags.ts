// Module `flags`'s data half (engine plan §6.5, §5.1): the world's `flags`, each declared with the section that owns it,
// the `{ set: <flag> }` effect that sets one inside a kernel trigger (`<trigger>#<source index>`, as the composed
// decoder names an owned effect), and a hotspot's `when`, its presence: a gating condition (any atom, a flag's
// included) the hotspot is shown, tapped, filled and used only while it holds. A flag is set-only: nothing clears it
// but its section's reset, so the proof stays finite. Its fact kind `flag` is the module's (`owns.facts`), the save
// keeps the set in `WorldState.flags`, and the atom `{ flag: <id> }` reads it in any condition. Engine half: decoded at
// chapter load into `world.mods.flags`, written back by `encode` for emission and the version hash. Function
// declarations and types only: mechanics/data/index.ts builds the entry from them, so the registry loads from any
// module first (the cycle through data/conditions.ts). Its data is plain JSON. Pure.
import type { WorldState } from '../../explore/state.ts';
import type { Result } from '../../story/catalog.ts';
import type { SectionId } from '../../story/staging.ts';
import type { HotspotKey } from '../../world/types.ts';
import type { DecodeCtx, FlagId, Issue, IssueReport, KernelWorld, OwnedAt, OwnedRaw } from '../contract.ts';
import { decodeCond } from './conditions.ts';
import type { Cond } from './conditions.ts';

/** One declared flag: the section whose effects alone set it (`world/flag-scope`) and whose reset clears it. */
export type FlagDecl = { readonly section: SectionId };

export type FlagsData = {
  /** Every declared flag with its owning section, in source order. */
  readonly flags: Readonly<Record<FlagId, FlagDecl>>;
  /** Each `{ set }` effect by `<trigger>#<source index>`, as the composed decoder names it. */
  readonly sets: Readonly<Record<string, FlagId>>;
  /** Each hotspot's presence condition; a hotspot without one (or with `when: null`) is absent here: always present. */
  readonly when: Readonly<Record<HotspotKey, Cond>>;
  /** `<place>:<id>` -> source path, so `encode` writes back and the lints report the author's line. */
  readonly paths: Readonly<Record<string, string>>;
};

type Obj = Readonly<Record<string, unknown>>;

const ID_RE = /^[a-z][a-z0-9_]*$/;
const DECL_KEYS = ['section'];

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A flag id by the id pattern (whether it is declared is the lint's, `world/flag-unknown-ref`); undefined after its issue. */
function flagId(v: unknown, path: string, report: IssueReport): FlagId | undefined {
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    report(path, 'id', `${JSON.stringify(v) ?? 'undefined'} is not a flag id ${ID_RE.source}`);
    return undefined;
  }
  return v as FlagId; // an id by the pattern
}

/** The `flag` atom's value (`atoms.flag`, gating): a flag id. */
export function decodeFlagAtom(v: unknown, path: string, report: IssueReport): FlagId | undefined {
  return flagId(v, path, report);
}

/** `flags`: `{ <flag>: { section } }`, strict keys; whether the section exists is the lint's. */
function declsOf(v: unknown, report: IssueReport): Record<string, FlagDecl> {
  const out: Record<string, FlagDecl> = {};
  if (!isObject(v)) {
    report('flags', 'shape', 'not an object of { <flag>: { section } } declarations');
    return out;
  }
  for (const [id, decl] of Object.entries(v)) {
    const path = `flags.${id}`;
    if (!ID_RE.test(id)) {
      report(path, 'id', `'${id}' is not a flag id ${ID_RE.source}`);
      continue;
    }
    if (!isObject(decl)) {
      report(path, 'shape', 'not a { section } declaration');
      continue;
    }
    const extra = Object.keys(decl).filter((key) => !DECL_KEYS.includes(key));
    if (extra.length > 0) {
      report(path, 'shape', `unknown key ${extra.join(', ')} (a declaration has ${DECL_KEYS.join(', ')})`);
    }
    const section = decl['section'];
    if (!Object.hasOwn(decl, 'section')) {
      report(`${path}.section`, 'shape', 'missing');
    } else if (typeof section !== 'string' || !ID_RE.test(section)) {
      report(`${path}.section`, 'id', `${JSON.stringify(section) ?? 'undefined'} is not a section id ${ID_RE.source}`);
    } else {
      out[id] = { section: section as SectionId }; // an id by the pattern
    }
  }
  return out;
}

/** Strict keys, every issue reported, each at its source path. An absent `flags` and no `set` decode to the defaults. */
export function decodeFlags(raw: OwnedRaw, ctx: DecodeCtx): Result<FlagsData, Issue[]> {
  const error: Issue[] = [];
  const report: IssueReport = (path, reason, detail) => {
    error.push({ path, reason, detail });
  };
  let flags: Record<string, FlagDecl> = {};
  const sets: Record<string, FlagId> = {};
  const when: Record<string, Cond> = {};
  const paths: Record<string, string> = {};
  for (const a of raw) {
    if (a.place === 'world') {
      flags = declsOf(a.raw['flags'], report);
    } else if (a.place === 'hotspot') {
      const v = a.raw['when'];
      if (v === null) {
        continue; // always present: the default, nothing to write back
      }
      const c = decodeCond(v, ctx, `${a.path}.when`);
      if (c.ok) {
        when[a.id] = c.value;
        paths[`hotspot:${a.id}`] = a.path;
      } else {
        for (const e of c.error) {
          report(e.path, e.reason, e.detail);
        }
      }
    } else if (a.place === 'effect') {
      const f = flagId(a.raw['set'], `${a.path}.set`, report);
      if (f !== undefined) {
        sets[a.id] = f;
        paths[`effect:${a.id}`] = a.path;
      }
    }
  }
  return error.length > 0 ? { ok: false, error } : { ok: true, value: { flags, sets, when, paths } };
}

/** The inverse of `decodeFlags`, defaults left out: a world without flags encodes [], so its body and version are
 *  unchanged. */
export function encodeFlags(d: FlagsData): OwnedRaw {
  const at = (place: OwnedAt['place'], id: string, raw: Obj): OwnedAt => ({ place, id, path: d.paths[`${place}:${id}`] ?? '', raw });
  return [
    ...(Object.keys(d.flags).length === 0 ? [] : [{ place: 'world', id: '', path: '', raw: { flags: d.flags } } as const]),
    ...Object.entries(d.sets).map(([id, f]) => at('effect', id, { set: f })),
    ...Object.entries(d.when).map(([id, c]) => at('hotspot', id, { when: c })),
  ];
}

/** Its facts are its own (`WorldState.flags`); reconcile's kernel steps pass them through unchanged. */
export function normalizeFlags(_w: KernelWorld, s: WorldState): WorldState {
  return s;
}
