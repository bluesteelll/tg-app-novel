// LX in happy-dom: the explore layer (PUZZLES-PLAN X10, X16; the LX cut D14): hotspot buttons placed by the
// controller's boxes, the reveal outline, the bar, and the reader rules over the explore components (copies of
// L14b's readers as ui/puzzles/puzzle-host.svelte.test.ts holds them; RULINGS 55 accepts copies).
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';

import { t } from '../../i18n/index.ts';
import type { Lang } from '../../i18n/index.ts';
import type { DocId, HotspotKey, ItemId } from '../../world/types.ts';
import { createExploreView } from '../explore-view.svelte.ts';
import type { DocView, ExploreLayerProps, HotspotView, ItemView, LockView } from '../explore-view.svelte.ts';
import { GLYPH_PATHS } from '../glyphs.ts';
import ExploreView from './ExploreView.svelte';
import exploreViewSource from './ExploreView.svelte?raw';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (L14a), so each test unmounts what it rendered here.
afterEach(() => cleanup());

const LANGS: readonly Lang[] = ['ru', 'en'];
const k = (s: string) => s as HotspotKey;

/** Three hotspots as the controller writes them: an exit, an examined look, a locked object. */
function spots(lang: Lang): HotspotView[] {
  return [
    { key: k('hall.to_study'), kind: 'exit', label: `${lang} study door`, css: { x: 5.4296875, y: 65.9375, w: 379.140625, h: 659.375 }, done: false, locked: false },
    { key: k('hall.inscription'), kind: 'look', label: `${lang} inscription`, css: { x: 177.12109375, y: 369.50390625, w: 44, h: 44 }, done: true, locked: false },
    { key: k('hall.gate'), kind: 'object', label: `${lang} gate`, css: { x: 10, y: 20, w: 61.8, h: 61.8 }, done: false, locked: true },
  ];
}

function layerProps(over: Partial<ExploreLayerProps> = {}): ExploreLayerProps {
  return {
    lang: 'en',
    hotspots: spots(over.lang ?? 'en'),
    reveal: false,
    items: [],
    docs: [],
    lock: null,
    panel: null,
    ontap: () => {},
    oninventory: () => {},
    onreveal: () => {},
    onread: () => {},
    oninsert: () => {},
    onclose: () => {},
    ...over,
  };
}

/** The declarations of every rule of a component's <style> whose selector list names the class `cls` (LP2's reader). */
function declarationsFor(source: string, cls: string): Map<string, string> {
  const style = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1] ?? '').join('\n');
  const out = new Map<string, string>();
  for (const m of style.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.some((s) => new RegExp(`\\.${cls}(?![\\w-])`).test(s) && !s.includes(':'))) {
      continue;
    }
    for (const decl of (m[2] ?? '').split(';')) {
      const [prop, ...value] = decl.split(':');
      if (prop !== undefined && value.length > 0) {
        out.set(prop.trim(), value.join(':').trim());
      }
    }
  }
  return out;
}

test('explore view: reveal shows outlines', async () => {
  // The store starts empty: no layer, no panel, no outline.
  const store = createExploreView();
  expect([store.layer, store.panel, store.hotspots, store.reveal]).toEqual([null, null, [], false]);
  for (const lang of LANGS) {
    const onreveal = vi.fn();
    const { container, getByRole, rerender, unmount } = render(ExploreView, layerProps({ lang, onreveal }));
    expect(container.querySelectorAll('.hotspot'), lang).toHaveLength(3);
    expect(container.querySelectorAll('.revealed'), lang).toHaveLength(0);
    await fireEvent.click(getByRole('button', { name: t(lang, 'explore.bar_reveal') }));
    expect(onreveal, lang).toHaveBeenCalledTimes(1);
    // GameSession writes the controller's 2 s outline into the store; every spot shows, the examined one marked.
    await rerender({ reveal: true });
    const shownSpots = [...container.querySelectorAll('.hotspot')];
    expect(shownSpots.every((b) => b.classList.contains('revealed')), lang).toBe(true);
    expect(shownSpots.filter((b) => b.classList.contains('done')).map((b) => b.getAttribute('aria-label')), lang).toEqual([`${lang} inscription`]);
    expect(shownSpots.filter((b) => b.classList.contains('locked')).map((b) => b.getAttribute('aria-label')), lang).toEqual([`${lang} gate`]);
    await rerender({ reveal: false });
    expect(container.querySelectorAll('.revealed'), lang).toHaveLength(0);
    unmount();
  }
  // An outline, not a border: nothing shifts when it comes and goes.
  expect(declarationsFor(exploreViewSource, 'revealed').get('outline')).toBeDefined();
  expect(declarationsFor(exploreViewSource, 'revealed').has('border')).toBe(false);
});

test('explore view: hotspot buttons have labels', async () => {
  for (const lang of LANGS) {
    const ontap = vi.fn<(key: HotspotKey) => void>();
    const oninventory = vi.fn();
    const { getByRole, unmount } = render(ExploreView, layerProps({ lang, ontap, oninventory }));
    for (const view of spots(lang)) {
      const button = getByRole('button', { name: view.label });
      expect(button.getAttribute('type'), view.label).toBe('button');
      expect(button.classList.contains('hotspot'), view.label).toBe(true);
      // Placed in stage-host px as the controller computed them (the CSSOM serializes lengths to 6 decimals).
      const placed = [button.style.left, button.style.top, button.style.width, button.style.height];
      expect(placed.every((v) => v.endsWith('px')), view.label).toBe(true);
      [view.css.x, view.css.y, view.css.w, view.css.h].forEach((n, i) => {
        expect(Number.parseFloat(placed[i] ?? ''), `${view.label} ${i}`).toBeCloseTo(n, 5);
      });
      // Exits carry the arrow glyph, so they are not told by colour alone; the other kinds carry none.
      expect(button.querySelectorAll('svg.exit-glyph').length, view.label).toBe(view.kind === 'exit' ? 1 : 0);
      await fireEvent.click(button);
    }
    expect(ontap.mock.calls, lang).toEqual(spots(lang).map((v) => [v.key]));
    await fireEvent.click(getByRole('button', { name: t(lang, 'explore.bar_inventory') }));
    expect(oninventory, lang).toHaveBeenCalledTimes(1);
    unmount();
  }
  // happy-dom computes no layout or cascade: the rules are read from the source (as puzzle-types.svelte.test.ts does).
  const hotspot = declarationsFor(exploreViewSource, 'hotspot');
  expect([hotspot.get('touch-action'), hotspot.get('-webkit-user-select'), hotspot.get('user-select')]).toEqual(['manipulation', 'none', 'none']);
  const layer = declarationsFor(exploreViewSource, 'layer');
  expect([layer.get('position'), layer.get('inset')]).toEqual(['absolute', '0']);
});

// ---------------------------------------------------------------------------------------------------------------
// C6: the panels over the rooms (X16, F7 step 5)

const SUN: ItemView = { id: 'medal_sun' as ItemId, name: 'Sun medal', desc: 'Warm to the touch', glyph: 'sun' };
const COIN: ItemView = { id: 'coin' as ItemId, name: 'Old coin', desc: 'Worn smooth', glyph: 'coin' };
const LETTER: DocView = { id: 'letter' as DocId, title: 'A letter', body: ['Dear friend,', 'the key is under the clock.'] };
const DIARY: DocView = { id: 'diary' as DocId, title: 'The diary', body: ['Day one.'] };

/** The `d` of each glyph path inside `el`, in document order. */
const glyphsIn = (el: Element): string[] => [...el.querySelectorAll('svg.glyph path')].map((p) => p.getAttribute('d') ?? '');

test('inventory: documents re-readable', async () => {
  for (const lang of LANGS) {
    const onread = vi.fn<(doc: DocId) => void>();
    const onclose = vi.fn();
    const { container, getByRole, queryByRole, rerender, unmount } = render(
      ExploreView,
      layerProps({ lang, items: [SUN], docs: [LETTER, DIARY], panel: { kind: 'inventory' }, onread, onclose }),
    );
    // The items tab first: each row shows its glyph, its name and its description.
    const rows = [...container.querySelectorAll('.item')];
    expect(rows.map((r) => [glyphsIn(r), (r.textContent ?? '').replace(/\s+/g, ' ').trim()]), lang).toEqual([
      [[GLYPH_PATHS.sun], 'Sun medal Warm to the touch'],
    ]);
    expect(queryByRole('button', { name: LETTER.title }), lang).toBeNull();
    // The files tab lists the documents; a tap opens one.
    await fireEvent.click(getByRole('tab', { name: t(lang, 'inv.files') }));
    await fireEvent.click(getByRole('button', { name: LETTER.title }));
    expect(onread.mock.calls, lang).toEqual([['letter']]);
    // GameSession opens the reader: the title and every paragraph.
    await rerender({ panel: { kind: 'doc', doc: LETTER.id } });
    const reader = container.querySelector('.reader');
    expect(reader?.querySelector('h2')?.textContent, lang).toBe(LETTER.title);
    expect([...(reader?.querySelectorAll('p') ?? [])].map((p) => p.textContent), lang).toEqual(LETTER.body);
    await fireEvent.click(getByRole('button', { name: t(lang, 'doc.close') }));
    expect(onclose, lang).toHaveBeenCalledTimes(1);
    // Back in the inventory the document is still there, on the same tab, and reads again.
    await rerender({ panel: { kind: 'inventory' } });
    expect(container.querySelector('.reader'), lang).toBeNull();
    await fireEvent.click(getByRole('button', { name: LETTER.title }));
    expect(onread.mock.calls, lang).toEqual([['letter'], ['letter']]);
    // Empty tabs say so.
    await rerender({ items: [], docs: [] });
    expect(getByRole('tabpanel').textContent?.trim(), lang).toBe(t(lang, 'inv.empty'));
    await fireEvent.click(getByRole('tab', { name: t(lang, 'inv.items') }));
    expect(getByRole('tabpanel').textContent?.trim(), lang).toBe(t(lang, 'inv.empty'));
    unmount();
  }
});

test('lock panel: wrong item refused right item inserts', async () => {
  const gate = (over: Partial<LockView> = {}): LockView => ({
    key: k('hall.gate'),
    title: 'The gate',
    locked: 'Three hollows in the iron',
    slots: [null, null, null],
    refused: false,
    ...over,
  });
  for (const lang of LANGS) {
    const oninsert = vi.fn<(key: HotspotKey, item: ItemId) => void>();
    const { container, getByRole, queryByRole, rerender, unmount } = render(
      ExploreView,
      layerProps({ lang, items: [COIN, SUN], lock: gate(), panel: { kind: 'lock' }, oninsert }),
    );
    const slotTexts = (): string[] => [...container.querySelectorAll('.slot')].map((s) => (s.textContent ?? '').trim());
    expect(container.querySelector('.lock h2')?.textContent, lang).toBe('The gate');
    expect(slotTexts(), lang).toEqual([1, 2, 3].map(() => t(lang, 'lock.slot_empty')));
    // A wrong item: the panel asks; the controller refuses.
    await fireEvent.click(getByRole('button', { name: COIN.name }));
    expect(oninsert.mock.calls, lang).toEqual([['hall.gate', 'coin']]);
    await rerender({ lock: gate({ refused: true }) });
    expect(getByRole('alert').textContent?.trim(), lang).toBe(t(lang, 'lock.no_fit'));
    expect(slotTexts(), lang).toEqual([1, 2, 3].map(() => t(lang, 'lock.slot_empty')));
    // The right item fills its slot and leaves the held list.
    await fireEvent.click(getByRole('button', { name: SUN.name }));
    expect(oninsert.mock.calls, lang).toEqual([
      ['hall.gate', 'coin'],
      ['hall.gate', 'medal_sun'],
    ]);
    await rerender({ lock: gate({ slots: [SUN, null, null] }), items: [COIN] });
    const first = container.querySelector('.slot');
    expect(first === null ? [] : glyphsIn(first), lang).toEqual([GLYPH_PATHS.sun]);
    expect(slotTexts(), lang).toEqual(['Sun medal', t(lang, 'lock.slot_empty'), t(lang, 'lock.slot_empty')]);
    expect(queryByRole('alert'), lang).toBeNull();
    expect(queryByRole('button', { name: SUN.name }), lang).toBeNull();
    expect(getByRole('button', { name: COIN.name }), lang).toBeDefined();
    unmount();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The reader rules (spec 2, K26): copies of L14b's readers over every component of this directory, with an exact
// value-import list per component (cut D14).

const COMPONENT_SOURCES = import.meta.glob<string>('./*.svelte', { query: '?raw', import: 'default', eager: true });

/** Each component and the only modules it may import as values. */
const VALUE_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  './ExploreView.svelte': ['../../i18n/index.ts', '../glyphs.ts', './DocumentReader.svelte', './Inventory.svelte', './LockPanel.svelte'],
  './Inventory.svelte': ['../../i18n/index.ts', '../glyphs.ts'],
  './LockPanel.svelte': ['../../i18n/index.ts', '../glyphs.ts'],
  './DocumentReader.svelte': ['../../i18n/index.ts'],
};
const COMPONENTS = Object.keys(VALUE_IMPORTS);

function sourceOf(name: string): string {
  const source = COMPONENT_SOURCES[name];
  if (source === undefined) {
    throw new Error(`invariant: ${name} is read`);
  }
  return source;
}

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

test('explore ui: components hold no literal text', () => {
  // Non-vacuous: exactly the listed components are read.
  expect(Object.keys(COMPONENT_SOURCES).sort()).toEqual([...COMPONENTS].sort());
  const offenders: string[] = [];
  for (const name of COMPONENTS) {
    const source = sourceOf(name);
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
  // The reader itself: a text node and a text attribute are found; an expression and a glyph are not.
  expect(literalText('<p>Подсказка</p><b aria-label="Close">✓</b><i title={t(lang, "k")}>{label}</i>')).toEqual([
    'aria-label="Close"',
    'text "Подсказка"',
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
 * The I/O a presentational component never does (spec 2): network, storage, globals, timers, frame callbacks and
 * listeners outside Svelte's own `on…` attributes. The reveal's 2 s timer is the controller's (cut D12).
 */
const IO_NAMES =
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator|window|globalThis|document|location|indexedDB|postMessage|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|addEventListener)\b/g;

/** A source without its comments (HTML, block and line comments). */
const withoutComments = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');

test('explore ui: components do no I/O', () => {
  expect(Object.keys(COMPONENT_SOURCES).sort()).toEqual([...COMPONENTS].sort());
  const offenders: string[] = [];
  for (const name of COMPONENTS) {
    const source = sourceOf(name);
    const refs = moduleRefs(name, source);
    // Exactly the listed value imports, each present (non-vacuous); type-only imports are erased and free.
    const values = [...new Set(refs.filter((r) => !r.typeOnly && !r.dynamic).map((r) => r.spec))].sort();
    if (JSON.stringify(values) !== JSON.stringify([...(VALUE_IMPORTS[name] ?? [])].sort())) {
      offenders.push(`${name}: value imports ${values.join(', ')}`);
    }
    for (const r of refs.filter((x) => x.dynamic)) {
      offenders.push(`${name}: dynamic ${r.spec}`);
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
  // The reader itself: a facade import is a value import beyond the list, a type import is not.
  const probe = "<script lang=\"ts\">\n  import { getTelegram } from '../../telegram/index.ts';\n  import type { Lang } from '../../i18n/index.ts';\n</script>";
  expect(moduleRefs('probe', probe).map((r) => [r.spec, r.typeOnly])).toEqual([
    ['../../telegram/index.ts', false],
    ['../../i18n/index.ts', true],
  ]);
});
