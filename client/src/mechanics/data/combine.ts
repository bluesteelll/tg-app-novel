// Module `combine`'s data half (engine plan §6.2, §5.1): the world's `recipes`, each two items `a` and `b` that, tapped
// one onto the other in either order, give `gives`; `keep` lists the inputs that stay held (tools), `when` gates the
// recipe (a gating condition of its section, §4) and `say` is a toast on every run. Engine half: decoded at chapter
// load into `world.mods.combine`, written back by `encode` for emission and the version hash. Function declarations
// and types only: mechanics/data/index.ts builds the entry from them, so the registry loads from any module first (the
// cycle through data/conditions.ts). Its data is plain JSON. Pure.
import type { WorldState } from '../../explore/state.ts';
import type { Result } from '../../story/catalog.ts';
import type { ItemId, WorldText } from '../../world/types.ts';
import type { DecodeCtx, Issue, IssueReport, KernelWorld, OwnedRaw } from '../contract.ts';
import { decodeCond } from './conditions.ts';
import type { Cond } from './conditions.ts';

export type Recipe = {
  readonly a: ItemId;
  readonly b: ItemId;
  readonly gives: ItemId;
  /** Inputs that stay held (tools); each is `a` or `b`, at most one of them: a recipe consumes at least one input
   *  (W1, RULINGS 307). Default []. */
  readonly keep: readonly ItemId[];
  /** A gating condition of the recipe's section (§4); default null. */
  readonly when: Cond | null;
  /** A toast on every run; default null. */
  readonly say: WorldText | null;
};

export type CombineData = { readonly recipes: readonly Recipe[] };

const RECIPE_KEYS = ['a', 'b', 'gives', 'keep', 'when', 'say'];
const ID_RE = /^[a-z][a-z0-9_]*$/;

function isObject(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** An item id by the id pattern (its item is the lint's, `world/recipe-unknown-ref`); null after its issue. */
function itemId(v: unknown, path: string, report: IssueReport): ItemId | null {
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    report(path, 'id', `not an item id ${ID_RE.source}`);
    return null;
  }
  return v as ItemId; // an id by the pattern
}

function recipeOf(v: unknown, path: string, ctx: DecodeCtx, report: IssueReport): Recipe | null {
  if (!isObject(v)) {
    report(path, 'shape', 'not a { a, b, gives, keep?, when?, say? } recipe');
    return null;
  }
  for (const key of Object.keys(v)) {
    if (!RECIPE_KEYS.includes(key)) {
      report(`${path}.${key}`, 'shape', `unknown key (a recipe has ${RECIPE_KEYS.join(', ')})`);
    }
  }
  const { keep = [], when = null, say = null } = v;
  const a = itemId(v['a'], `${path}.a`, report);
  const b = itemId(v['b'], `${path}.b`, report);
  const gives = itemId(v['gives'], `${path}.gives`, report);
  if (a !== null && a === b) {
    report(`${path}.b`, 'shape', 'the same item twice: a recipe combines two items');
  }
  if (gives !== null && (gives === a || gives === b)) {
    report(`${path}.gives`, 'shape', 'the product is one of its inputs: a recipe gives a third item');
  }
  const kept: ItemId[] = [];
  if (!Array.isArray(keep)) {
    report(`${path}.keep`, 'shape', 'not an array of the inputs that stay held');
  } else {
    keep.forEach((k: unknown, j) => {
      const input = k === a ? a : k === b ? b : null;
      if (input === null) {
        report(`${path}.keep.${j}`, 'shape', 'not an input of the recipe (a or b)');
      } else if (kept.includes(input)) {
        report(`${path}.keep.${j}`, 'shape', 'a repeat');
      } else {
        kept.push(input);
      }
    });
    // Its members passed the row above, so two are both inputs.
    if (kept.length === 2) {
      report(`${path}.keep`, 'shape', 'a recipe consumes at least one of its inputs');
    }
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
  const text = say === null ? null : ctx.text(say, `${path}.say`, report);
  return a === null || b === null || gives === null ? null : { a, b, gives, keep: kept, when: cond, say: text };
}

/** Strict keys, every issue reported, each at its source path (`recipes.<i>...`: the world place's path is ''). */
export function decodeCombine(raw: OwnedRaw, ctx: DecodeCtx): Result<CombineData, Issue[]> {
  const error: Issue[] = [];
  const report: IssueReport = (path, reason, detail) => {
    error.push({ path, reason, detail });
  };
  const recipes: Recipe[] = [];
  for (const at of raw) {
    const list = at.raw['recipes'];
    if (!Array.isArray(list)) {
      report('recipes', 'shape', 'not an array of recipes');
      continue;
    }
    list.forEach((v: unknown, i) => {
      const r = recipeOf(v, `recipes.${i}`, ctx, report);
      if (r !== null) {
        recipes.push(r);
      }
    });
  }
  return error.length > 0 ? { ok: false, error } : { ok: true, value: { recipes } };
}

function encodeRecipe(r: Recipe): Readonly<Record<string, unknown>> {
  return {
    a: r.a,
    b: r.b,
    gives: r.gives,
    ...(r.keep.length === 0 ? {} : { keep: r.keep }),
    ...(r.when === null ? {} : { when: r.when }),
    ...(r.say === null ? {} : { say: r.say }),
  };
}

/** The inverse of `decodeCombine`, defaults left out: a world without recipes encodes [], so its body and version are
 *  unchanged. */
export function encodeCombine(d: CombineData): OwnedRaw {
  return d.recipes.length === 0 ? [] : [{ place: 'world', id: '', path: '', raw: { recipes: d.recipes.map(encodeRecipe) } }];
}

/** Its facts are the kernel's (`held`, `used`), which reconcile's kernel steps keep. */
export function normalizeCombine(_w: KernelWorld, s: WorldState): WorldState {
  return s;
}
