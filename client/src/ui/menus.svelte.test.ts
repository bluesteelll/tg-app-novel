// L14b in happy-dom: the overlay menus (PROTOTYPE-PLAN L14b), the story picker (STORIES-PLAN Y14, Y15), the meta entry
// points (META-PLAN M9, M27) and the keys this lane declares for the puzzle, explore and hint UIs. Components render
// through @testing-library/svelte. Events are built by hand where `detail` matters: a pointer click has detail >= 1, a
// keyboard or assistive-technology activation has detail 0 (as in choices.svelte.test.ts).
import { cleanup, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';

import { en } from '../i18n/en.ts';
import { t, type Lang, type UiKey } from '../i18n/index.ts';
import { ru } from '../i18n/ru.ts';
import Notice from './Notice.svelte';
import type { NoticeView } from './Notice.svelte';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (L14a), so each test unmounts what it rendered here.
afterEach(() => cleanup());

const RU: Readonly<Record<string, string>> = ru;
const EN: Readonly<Record<string, string>> = en;
const LANGS: readonly Lang[] = ['ru', 'en'];

/** The `{name}` placeholders of a template, sorted. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1] ?? '').sort();
}

const down = (el: Element): void => {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
};
/** A pointer click with no pointerdown before it: the release of a press that began before the screen showed. */
const pointerClick = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
};
/** A keyboard or assistive-technology activation. */
const keyClick = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
};
/** A full pointer tap: pointerdown, then the click it produces; the DOM is not updated yet (a double tap). */
const rawTap = (el: Element): void => {
  down(el);
  pointerClick(el);
};
/** A full pointer tap, then Svelte's batched DOM update. */
const tap = (el: Element): void => {
  rawTap(el);
  flushSync();
};

/** The rendered text with runs of whitespace as one space. */
const shown = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const names = (els: readonly Element[]): string[] => els.map(shown);

// ---------------------------------------------------------------------------------------------------------------
// The keys declared for LX and LP2 (C2)

/**
 * The puzzle and explore keys (PROTOTYPE-PLAN "Changed by PUZZLES-PLAN"), with the hint group as META-PLAN M21 rewrote
 * it: no `buy`, `owned`, `terms` or `confirming` (no hint purchase), and no `locked` (LP2's ladder shows only the next
 * usable tier).
 */
const PREDECLARED = {
  explore: ['bar_inventory', 'bar_reveal', 'room_back', 'area_reset'],
  inv: ['items', 'files', 'empty', 'got_item', 'got_doc'],
  doc: ['close'],
  lock: ['slot_empty', 'no_fit', 'examine', 'locked'],
  puzzle: [
    'try',
    'checking',
    'wrong',
    'solved',
    'failed',
    'attempts_left',
    'give_up',
    'give_up_confirm',
    'give_up_yes',
    'hint',
    'offline',
    'rate_limited',
    'load_failed',
    'retry',
    'dial_up',
    'dial_down',
    'swap',
  ],
  hint: ['title', 'tier', 'use', 'unlocked', 'balance', 'get_more', 'unavailable', 'failed'],
} as const;

/** The plan's placeholders per key; every other declared key has none. */
const PREDECLARED_PLACEHOLDERS: Readonly<Record<string, readonly string[]>> = {
  'inv.got_item': ['name'],
  'inv.got_doc': ['title'],
  'puzzle.attempts_left': ['n'],
  'puzzle.rate_limited': ['s'],
  'hint.tier': ['n'],
  'hint.use': ['n'],
  'hint.balance': ['n'],
};

test('i18n: puzzle and explore keys declared', () => {
  for (const [group, names] of Object.entries(PREDECLARED)) {
    const want = names.map((n) => `${group}.${n}`).sort();
    const inGroup = (table: Readonly<Record<string, string>>): string[] =>
      Object.keys(table)
        .filter((k) => k.startsWith(`${group}.`))
        .sort();
    expect(inGroup(RU), `ru ${group}`).toEqual(want);
    expect(inGroup(EN), `en ${group}`).toEqual(want);
    for (const key of want) {
      expect(placeholders(RU[key] ?? ''), key).toEqual(PREDECLARED_PLACEHOLDERS[key] ?? []);
    }
  }
  // M9's toast rides the entry tables, so it shows before the meta chunk has loaded.
  expect(Object.keys(RU)).toContain('meta.card_later');
  expect(Object.keys(EN)).toContain('meta.card_later');
  expect(placeholders(RU['meta.card_later'] ?? '')).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// The full-screen notices (C3)

/** Each kind's title, body and actions (cut §1c). */
const NOTICE_COPY: ReadonlyArray<readonly [NoticeView['kind'], UiKey, UiKey | null, readonly UiKey[]]> = [
  ['open_in_telegram', 'notice.open_in_telegram_title', 'notice.open_in_telegram_body', []],
  ['reopen', 'notice.reopen_title', 'notice.reopen_body', []],
  ['error', 'notice.error_title', 'notice.error_body', ['notice.error_action']],
  ['story_error', 'notice.story_error_title', 'notice.story_error_body', ['notice.story_error_action']],
  ['to_be_continued', 'notice.to_be_continued_title', null, ['notice.to_be_continued_action']],
  ['the_end', 'notice.the_end_title', null, ['notice.the_end_action']],
];

/** A new notice object of `kind`: each one is a presentation of its own. */
function noticeOf(kind: NoticeView['kind'], onaction: () => void): NoticeView {
  switch (kind) {
    case 'open_in_telegram':
    case 'reopen':
      return { kind };
    case 'error':
    case 'story_error':
    case 'to_be_continued':
    case 'the_end':
      return { kind, onaction };
  }
}

test('menus: notice kinds show their actions', async () => {
  for (const lang of LANGS) {
    for (const [kind, title, body, actions] of NOTICE_COPY) {
      const where = `${lang} ${kind}`;
      const onaction = vi.fn();
      const { container, getByRole, queryAllByRole, rerender } = render(Notice, { notice: noticeOf(kind, onaction), lang });
      expect(shown(getByRole('heading')), where).toBe(t(lang, title));
      expect(names([...container.querySelectorAll('p')]), where).toEqual(body === null ? [] : [t(lang, body)]);
      expect(names(queryAllByRole('button')), where).toEqual(actions.map((key) => t(lang, key)));
      if (actions.length > 0) {
        tap(getByRole('button'));
        expect(onaction, where).toHaveBeenCalledTimes(1);
        // One action per presentation: a second tap (Retry, Return to last save) does not run it again.
        tap(getByRole('button'));
        expect(onaction, where).toHaveBeenCalledTimes(1);
        // A new notice object is a new presentation. Rule (b): the release of a press that began before it showed
        // does not count, a keyboard activation does.
        await rerender({ notice: noticeOf(kind, onaction) });
        pointerClick(getByRole('button'));
        expect(onaction, where).toHaveBeenCalledTimes(1);
        keyClick(getByRole('button'));
        expect(onaction, where).toHaveBeenCalledTimes(2);
        tap(getByRole('button'));
        expect(onaction, where).toHaveBeenCalledTimes(2);
      }
      cleanup();
    }
  }
});

test('menus: the end offers the card when it exists', () => {
  for (const lang of LANGS) {
    const onaction = vi.fn();
    const oncard = vi.fn();
    const { getAllByRole, getByRole } = render(Notice, { notice: { kind: 'the_end', onaction, oncard }, lang });
    expect(names(getAllByRole('button'))).toEqual([t(lang, 'notice.the_end_action'), t(lang, 'notice.the_end_card')]);
    const card = getByRole('button', { name: t(lang, 'notice.the_end_card') });
    tap(card);
    expect(oncard).toHaveBeenCalledTimes(1);
    // The card action is a retry (M9: a flush or a card request that failed), so it is never latched.
    tap(card);
    expect(oncard).toHaveBeenCalledTimes(2);
    pointerClick(card);
    expect(oncard).toHaveBeenCalledTimes(2);
    expect(onaction).not.toHaveBeenCalled();
    cleanup();

    const without = render(Notice, { notice: { kind: 'the_end', onaction }, lang });
    expect(names(without.getAllByRole('button'))).toEqual([t(lang, 'notice.the_end_action')]);
    cleanup();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// No literal text and no I/O in this lane's components (C3-C8; principle 8, spec 2 and 4)

/** This lane's components; L14a's six and App.svelte (L15) are not among them. */
const MENU_COMPONENTS = ['Notice.svelte'] as const;

const COMPONENT_SOURCES = import.meta.glob<string>('./*.svelte', { query: '?raw', import: 'default', eager: true });

/** The markup with every `{…}` (expressions, blocks, tags) blanked; braces nest, as in an inline handler body. */
function withoutMustaches(text: string): string {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') {
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
    } else if (depth === 0) {
      out += ch;
      continue;
    }
    out += ' ';
  }
  return out;
}

/** A component without its comments, scripts and styles. */
const markupOf = (source: string): string =>
  source.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');

/** Where a component shows a literal string: text nodes and the text attributes, outside scripts and styles. */
function literalText(source: string): string[] {
  const markup = withoutMustaches(markupOf(source));
  const found: string[] = [];
  for (const m of markup.matchAll(/\b(aria-label|title|alt|placeholder)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = m[2] ?? m[3] ?? '';
    if (/\p{L}/u.test(value)) {
      found.push(`${m[1]}="${value}"`);
    }
  }
  for (const m of markup.replace(/<[^>]*>/g, ' ').matchAll(/\S*\p{L}\S*/gu)) {
    found.push(`text "${m[0]}"`);
  }
  return found;
}

test('i18n: menu components hold no literal text', () => {
  const files = Object.keys(COMPONENT_SOURCES).map((key) => key.replace(/^\.\//, ''));
  // Non-vacuous: every listed component is read, so a renamed or missing file cannot pass.
  expect(files.filter((n) => (MENU_COMPONENTS as readonly string[]).includes(n)).sort()).toEqual([...MENU_COMPONENTS].sort());
  const offenders: string[] = [];
  for (const name of MENU_COMPONENTS) {
    const source = COMPONENT_SOURCES[`./${name}`] ?? '';
    expect(source, name).toContain('</');
    for (const literal of literalText(source)) {
      offenders.push(`${name}: ${literal}`);
    }
    // Russian belongs in ru.ts only: no Cyrillic in a component, in its script or inside `{…}` either.
    if (/\p{Script=Cyrillic}/u.test(source)) {
      offenders.push(`${name}: Cyrillic in the source`);
    }
  }
  expect(offenders).toEqual([]);

  // The reader itself: a text node and a text attribute are found, an expression and a glyph are not.
  expect(literalText('<p>Меню</p><b aria-label="Close">×</b><i title={t(lang, "k")}>{label}</i>')).toEqual([
    'aria-label="Close"',
    'text "Меню"',
  ]);
});

/** One module reference: `type` when erased (`import type`, `export type … from`, `import('x').T`). */
type ModuleRef = { spec: string; typeOnly: boolean; dynamic: boolean };

/** Every module reference of a component's scripts, read with the TypeScript parser (LU1's reader). */
function moduleRefs(file: string, text: string): ModuleRef[] {
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1] ?? '');
  const out: ModuleRef[] = [];
  for (const script of scripts) {
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        // `import { type X }` keeps the declaration (verbatimModuleSyntax): only `import type` is type-only.
        const typeOnly = node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
        out.push({ spec: node.moduleSpecifier.text, typeOnly, dynamic: false });
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
        const spec = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '<computed>';
        out.push({ spec, typeOnly: node.isTypeOnly, dynamic: false });
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        const spec = arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : '<computed>';
        out.push({ spec, typeOnly: false, dynamic: true });
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        const literal = node.argument.literal;
        out.push({ spec: ts.isStringLiteral(literal) ? literal.text : '<computed>', typeOnly: true, dynamic: false });
      }
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(`${file}.ts`, script, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS));
  }
  return out;
}

/**
 * The I/O a presentational overlay never does (spec 2): network, storage, globals, timers, frame callbacks (critique
 * O6) and listeners outside Svelte's own `on…` attributes. Dialogs and window.open are arch's rules.
 */
const IO_NAMES =
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator|window|globalThis|document|location|indexedDB|postMessage|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|addEventListener)\b/g;

/** A source without its comments (HTML, block and line comments). */
const withoutComments = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');

test('menus: components do no I/O', () => {
  const offenders: string[] = [];
  for (const name of MENU_COMPONENTS) {
    const source = COMPONENT_SOURCES[`./${name}`] ?? '';
    const refs = moduleRefs(name, source);
    // Non-vacuous: every component reads the UI tables through t().
    expect(
      refs.filter((r) => !r.typeOnly).map((r) => r.spec),
      name,
    ).toContain('../i18n/index.ts');
    for (const r of refs) {
      if (r.dynamic || (!r.typeOnly && r.spec !== '../i18n/index.ts')) {
        offenders.push(`${name}: ${r.dynamic ? 'dynamic' : 'value'} ${r.spec}`);
      }
    }
    const code = withoutComments(source);
    for (const m of code.matchAll(IO_NAMES)) {
      offenders.push(`${name}: ${m[0]}`);
    }
    // A link leaves the app only through a callback (the facade's openLink is the caller's).
    const markup = markupOf(code);
    if (/<a\b/i.test(markup)) {
      offenders.push(`${name}: <a>`);
    }
    if (/\bhref\b/i.test(markup)) {
      offenders.push(`${name}: href`);
    }
  }
  expect(offenders).toEqual([]);
});
