// Story line text by language (PROTOTYPE-PLAN "Localization", principle 8): ru is the ink text itself, en comes from the
// chapter's line table by line ID. A line the table lacks (or a table not loaded yet) falls back to ru and is counted,
// so a missing translation shows instead of vanishing. Pure: the table and `lang` are arguments, no global state.
import type { LineId } from '../story/staging.ts';
import type { Lang } from './index.ts';

export interface LineText {
  /** The line in `lang`; `ru` is the runner's ink text for `lineId`. */
  text(lineId: LineId, ru: string, lang: Lang): string;
  /** en lookups that fell back to ru so far. */
  missing(): number;
}

/** Line text over one chapter's en table (`null`: not loaded); `onMissing` hears each fallback (a dev log). */
export function createLineText(en: Readonly<Record<LineId, string>> | null, onMissing?: (id: LineId) => void): LineText {
  let missed = 0;
  return {
    text(lineId, ru, lang) {
      if (lang === 'ru') {
        return ru;
      }
      // Own entries only: an inherited name ('toString', '__proto__') is never a translation.
      const found = en !== null && Object.hasOwn(en, lineId) ? en[lineId] : undefined;
      if (found !== undefined) {
        return found;
      }
      missed += 1;
      onMissing?.(lineId);
      return ru;
    },
    missing: () => missed,
  };
}
