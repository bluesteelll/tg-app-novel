// UI strings by language (principle 8). The tables are pure data and `lang` is an argument, so there is no global
// language state: a component takes `lang` as a prop. The result is plain text, rendered through Svelte's escaping.
import { en } from './en.ts';
import { ru } from './ru.ts';

/** A UI language: Russian first, English second. */
export type Lang = 'ru' | 'en';
/** A key of the UI tables; ru.ts defines the set. */
export type UiKey = keyof typeof ru;

const TABLES: Readonly<Record<Lang, Readonly<Record<UiKey, string>>>> = { ru, en };
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The string under `key` in `lang`, with each `{name}` replaced by `params[name]` in one pass. A placeholder without
 * an own parameter stays as written, so a missing value shows instead of vanishing.
 */
export function t(lang: Lang, key: UiKey, params?: Readonly<Record<string, string | number>>): string {
  const text = TABLES[lang][key];
  if (params === undefined) {
    return text;
  }
  return text.replace(PLACEHOLDER, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}
