// Module `use`'s data half (engine plan §6.1, §5.1): a hotspot's `uses` rules (item-first use: the first rule whose
// item matches and whose `when` holds runs its `do`), a lock slot's `keep` (a tool that stays held), and an item's or a
// room's `refuse` text. Engine half: decoded at chapter load into `world.mods.use`, written back by `encode` for
// emission and the version hash. Function declarations and types only: mechanics/data/index.ts builds the entry from
// them, so the registry loads from any module first (the cycle through data/conditions.ts). Its data is plain JSON.
// Pure.
import type { WorldState } from '../../explore/state.ts';
import type { Result } from '../../story/catalog.ts';
import type { KnotName } from '../../story/staging.ts';
import type { Effect, HotspotKey, ItemId, RoomId, WorldText } from '../../world/types.ts';
import type { DecodeCtx, Issue, IssueReport, KernelWorld, OwnedAt, OwnedRaw } from '../contract.ts';
import { decodeCond } from './conditions.ts';
import type { Cond } from './conditions.ts';

/** One rule of a target hotspot: `keep` false consumes the item (`held - item`, `used + item`). */
export type UseRule = {
  readonly item: ItemId;
  readonly keep: boolean;
  readonly when: Cond | null;
  /** The kernel's effects, fired once as `use:<target>#<rule index>`. */
  readonly do: readonly Effect[];
  /** Shown on every run. */
  readonly say: WorldText | null;
};

export type UseData = {
  /** Each target's rules, in source order. */
  readonly uses: Readonly<Record<HotspotKey, readonly UseRule[]>>;
  /** The slots that keep their item, `<HotspotKey>#<slot index>`. */
  readonly keep: readonly string[];
  readonly refuse: { readonly items: Readonly<Record<ItemId, WorldText>>; readonly rooms: Readonly<Record<RoomId, WorldText>> };
  /** Each owned place's source path, by `<place>:<id>` (`OwnedAt.path`): `encode` writes every value back there. */
  readonly paths: Readonly<Record<string, string>>;
};

const RULE_KEYS = ['item', 'keep', 'when', 'do', 'say'];

function isObject(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A rule's `do`: the kernel's three effect forms, by shape (their ids are `world/use-unknown-ref`'s). */
function effectsOf(v: unknown, path: string, report: IssueReport): Effect[] {
  if (!Array.isArray(v)) {
    report(path, 'shape', 'not an array of effects');
    return [];
  }
  return v.flatMap((e: unknown, i): Effect[] => {
    const keys = isObject(e) ? Object.keys(e) : [];
    const [kind = ''] = keys;
    const value = isObject(e) ? e[kind] : undefined;
    if (keys.length !== 1 || !['give', 'unlock', 'story'].includes(kind) || typeof value !== 'string') {
      report(`${path}.${i}`, 'shape', 'not an effect with exactly one key of give, unlock, story (a string)');
      return [];
    }
    // One key of the three, holding a string: the kernel's Effect of that form.
    return [kind === 'give' ? { give: value as ItemId } : kind === 'unlock' ? { unlock: value as HotspotKey } : { story: value as KnotName }];
  });
}

function ruleOf(v: unknown, path: string, ctx: DecodeCtx, report: IssueReport): UseRule {
  const r = isObject(v) ? v : {};
  if (!isObject(v)) {
    report(path, 'shape', 'not a { item, keep?, when?, do?, say? } rule');
  }
  for (const key of Object.keys(r)) {
    if (!RULE_KEYS.includes(key)) {
      report(`${path}.${key}`, 'shape', `unknown key (a rule has ${RULE_KEYS.join(', ')})`);
    }
  }
  const { item, keep = false, when = null, do: effects = [], say = null } = r;
  if (typeof item !== 'string') {
    report(`${path}.item`, 'shape', 'missing: a rule names the item it uses (a string)');
  }
  if (typeof keep !== 'boolean') {
    report(`${path}.keep`, 'shape', 'not a boolean');
  }
  let cond: Cond | null = null;
  if (when !== null) {
    const c = decodeCond(when, ctx, `${path}.when`);
    if (c.ok) {
      cond = c.value;
    } else {
      for (const e of c.error) {
        report(e.path, e.reason, e.detail);
      }
    }
  }
  return {
    item: String(item) as ItemId, // a string unless reported above; its id is the lint's
    keep: keep === true,
    when: cond,
    do: effectsOf(effects, `${path}.do`, report),
    say: say === null ? null : ctx.text(say, `${path}.say`, report),
  };
}

/** Strict keys, every issue reported, each at its source path. */
export function decodeUse(raw: OwnedRaw, ctx: DecodeCtx): Result<UseData, Issue[]> {
  const error: Issue[] = [];
  const report: IssueReport = (path, reason, detail) => {
    error.push({ path, reason, detail });
  };
  const uses: Record<string, UseRule[]> = {};
  const keep: string[] = [];
  const items: Record<string, WorldText> = {};
  const rooms: Record<string, WorldText> = {};
  const paths: Record<string, string> = {};
  for (const a of raw) {
    const { uses: list, keep: kept, refuse } = a.raw;
    if (a.place === 'hotspot') {
      if (!Array.isArray(list)) {
        report(`${a.path}.uses`, 'shape', 'not an array of rules');
        continue;
      }
      uses[a.id] = list.map((v: unknown, i) => ruleOf(v, `${a.path}.uses.${i}`, ctx, report));
    } else if (a.place === 'slot') {
      if (typeof kept !== 'boolean') {
        report(`${a.path}.keep`, 'shape', 'not a boolean');
      }
      if (kept !== true) {
        continue; // false is the default: nothing to keep, nothing to write back
      }
      keep.push(a.id);
    } else {
      (a.place === 'item' ? items : rooms)[a.id] = ctx.text(refuse, `${a.path}.refuse`, report);
    }
    paths[`${a.place}:${a.id}`] = a.path;
  }
  return error.length > 0 ? { ok: false, error } : { ok: true, value: { uses, keep, refuse: { items, rooms }, paths } };
}

function encodeRule(r: UseRule): Readonly<Record<string, unknown>> {
  return {
    item: r.item,
    ...(r.keep ? { keep: true } : {}),
    ...(r.when === null ? {} : { when: r.when }),
    ...(r.do.length === 0 ? {} : { do: r.do }),
    ...(r.say === null ? {} : { say: r.say }),
  };
}

/** The inverse of `decodeUse`, defaults left out: a world without `use` keys encodes [], so its body is unchanged. */
export function encodeUse(d: UseData): OwnedRaw {
  const at = (place: OwnedAt['place'], id: string, raw: Readonly<Record<string, unknown>>): OwnedAt => ({ place, id, path: d.paths[`${place}:${id}`] ?? '', raw });
  return [
    ...Object.entries(d.uses).map(([id, rules]) => at('hotspot', id, { uses: rules.map(encodeRule) })),
    ...d.keep.map((id) => at('slot', id, { keep: true })),
    ...Object.entries(d.refuse.items).map(([id, text]) => at('item', id, { refuse: text })),
    ...Object.entries(d.refuse.rooms).map(([id, text]) => at('room', id, { refuse: text })),
  ];
}

/** Its facts are the kernel's (`held`, `used`, a `use:` fired key), which reconcile's kernel steps keep. */
export function normalizeUse(_w: KernelWorld, s: WorldState): WorldState {
  return s;
}
