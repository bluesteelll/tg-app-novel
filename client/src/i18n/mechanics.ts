// The mechanics' UI strings (engine plan §6.1 UI, 12c GM3u; §7.4 GM7r): the item ribbon's label, the text a refused use
// shows when neither its item nor its room says why, and the update toast of a reach mismatch. Their own table,
// imported only by app/yields.ts (the engine) and the explore UI (the ribbon), so these texts ship with the engine and
// never in the entry (`arch: the mechanics string table loads with the engine, never with the entry`). Russian first
// (its keys are the contract), English second; the first two are drafts for the owner's copy pass (OPEN-QUESTIONS Q61,
// RULINGS 226 Q6); `mech.content_updated` is the owner's adopted copy (Q15e, RULINGS 154).
import type { Lang } from './index.ts';

/** Every mechanics string, in Russian. */
export const mechanicsRu = {
  'mech.ribbon': 'Предметы',
  'mech.use_refused': 'Ничего не происходит.',
  'mech.content_updated': 'Игра обновилась. Закройте её и откройте снова.',
} as const;

/** A key of the mechanics table; mechanicsRu defines the set. */
export type MechanicsKey = keyof typeof mechanicsRu;

/** Every mechanics string, in English: a key missing here is TS2741 and an extra one TS2353. */
export const mechanicsEn: Readonly<Record<MechanicsKey, string>> = {
  'mech.ribbon': 'Items',
  'mech.use_refused': 'Nothing happens.',
  'mech.content_updated': 'The game was updated. Close it and open it again.',
};

const TABLES: Readonly<Record<Lang, Readonly<Record<MechanicsKey, string>>>> = { ru: mechanicsRu, en: mechanicsEn };
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The mechanics string under `key` in `lang`, with each `{name}` replaced by `params[name]` in one pass; t()'s rule
 * (i18n/index.ts), copied so this table never joins the entry's module graph (as i18n/meta.ts's `mt`).
 */
export function mechT(lang: Lang, key: MechanicsKey, params?: Readonly<Record<string, string | number>>): string {
  const text = TABLES[lang][key];
  if (params === undefined) {
    return text;
  }
  return text.replace(PLACEHOLDER, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}
