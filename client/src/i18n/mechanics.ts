// The mechanics' UI strings (engine plan §6.1 UI, 12c GM3u; §7.4 GM7r; §7.2 GM7p): the item ribbon's label, the text a
// refused use shows when neither its item nor its room says why, the update toast of a reach mismatch, and the path
// puzzle's rule line and cell names. Their own table, imported only by app/yields.ts (the engine), the explore UI (the
// ribbon) and the path type UI (its rule and cells), so these texts ship with the engine and never in the entry
// (`arch: the mechanics string table loads with the engine, never with the entry`). Russian first (its keys are the
// contract), English second; all but `mech.content_updated` are drafts for the owner's copy pass (OPEN-QUESTIONS Q61,
// RULINGS 226 Q6); `mech.content_updated` is the owner's adopted copy (Q15e, RULINGS 154).
import type { Lang } from './index.ts';

/** Every mechanics string, in Russian. */
export const mechanicsRu = {
  'mech.ribbon': 'Предметы',
  'mech.use_refused': 'Ничего не происходит.',
  'mech.content_updated': 'Игра обновилась. Закройте её и откройте снова.',
  'mech.path_rule': 'Проведите одну линию от конца до конца через все свободные клетки.',
  'mech.path_cell': 'Ряд {r}, клетка {c}',
  'mech.path_end': 'Конец линии: ряд {r}, клетка {c}',
} as const;

/** A key of the mechanics table; mechanicsRu defines the set. */
export type MechanicsKey = keyof typeof mechanicsRu;

/** Every mechanics string, in English: a key missing here is TS2741 and an extra one TS2353. */
export const mechanicsEn: Readonly<Record<MechanicsKey, string>> = {
  'mech.ribbon': 'Items',
  'mech.use_refused': 'Nothing happens.',
  'mech.content_updated': 'The game was updated. Close it and open it again.',
  'mech.path_rule': 'Draw one line from end to end through every free cell.',
  'mech.path_cell': 'Row {r}, cell {c}',
  'mech.path_end': 'Line end: row {r}, cell {c}',
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
