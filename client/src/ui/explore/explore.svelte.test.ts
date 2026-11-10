// LX in happy-dom: the explore layer (PUZZLES-PLAN X10, X16; the LX cut D14): hotspot buttons placed by the
// controller's boxes, the reveal outline, the bar, and the reader rules over the explore components (copies of
// L14b's readers as ui/puzzles/puzzle-host.svelte.test.ts holds them; RULINGS 55 accepts copies). GM3u (engine plan
// §6.1 UI, §8.3, §8.5): the controls' cues, the hit areas, and the layer over the real cue stage on a real flush.
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { flushSync, mount, tick, unmount } from 'svelte';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';

import { createCueBus } from '../../cues/bus.ts';
import type { CueBus } from '../../cues/bus.ts';
import { CueStage } from '../../cues/stage/index.ts';
import { PRESETS } from '../../cues/stage/presets.ts';
import type { CueEvent } from '../../cues/types.ts';
import { LAYER_MOTIONS } from '../../cues/visible.ts';
import type { Box } from '../../geom/cover.ts';
import { t } from '../../i18n/index.ts';
import type { Lang } from '../../i18n/index.ts';
import type { Cause, FactKind } from '../../mechanics/contract.ts';
import type { DocId, HotspotKey, ItemId } from '../../world/types.ts';
import { createExploreView, forwardLayer } from '../explore-view.svelte.ts';
import type {
  DocView,
  ExploreLayerActions,
  ExploreLayerProps,
  ExploreViewStore,
  HotspotView,
  ItemView,
  LockView,
} from '../explore-view.svelte.ts';
import { GLYPH_PATHS } from '../glyphs.ts';
import { createPuzzleView } from '../puzzle-view.svelte.ts';
import type { PuzzleHostCallbacks } from '../puzzle-view.svelte.ts';
import type { CueStageProps } from '../state.svelte.ts';
import ExploreView from './ExploreView.svelte';
import exploreViewSource from './ExploreView.svelte?raw';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (L14a), so each test unmounts what it rendered here;
// a test that installed the stage rig gets the real clock and DOM methods back after its components are gone.
afterEach(() => {
  cleanup();
  unstage();
});

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

/** What a test sets: the language, the view store's fields and the layer's callbacks, each by name. */
type LayerOver = { lang?: Lang } & Partial<Pick<ExploreViewStore, 'hotspots' | 'reveal' | 'items' | 'docs' | 'lock' | 'panel' | 'selected'>> &
  Partial<ExploreLayerActions>;

/** The layer's props over a new view store with `over` written into it; a test writes the store as GameSession does. */
function layerProps(over: LayerOver = {}): ExploreLayerProps {
  const lang = over.lang ?? 'en';
  const view = createExploreView();
  view.hotspots = over.hotspots ?? spots(lang);
  view.reveal = over.reveal ?? false;
  view.items = over.items ?? [];
  view.docs = over.docs ?? [];
  view.lock = over.lock ?? null;
  view.panel = over.panel ?? null;
  view.selected = over.selected ?? null;
  const puzzleActions: PuzzleHostCallbacks = {
    item: () => null,
    onchange: () => {},
    ontry: () => {},
    ongiveup: () => {},
    onhint: () => {},
    onretry: () => {},
    onusehint: () => {},
    ongetmore: () => {},
  };
  return {
    lang,
    view,
    actions: {
      ontap: over.ontap ?? (() => {}),
      oninventory: over.oninventory ?? (() => {}),
      onreveal: over.onreveal ?? (() => {}),
      onread: over.onread ?? (() => {}),
      oninsert: over.oninsert ?? (() => {}),
      onclose: over.onclose ?? (() => {}),
      onselect: over.onselect ?? (() => {}),
      ondeselect: over.ondeselect ?? (() => {}),
      onuse: over.onuse ?? (() => {}),
    },
    puzzle: createPuzzleView(),
    puzzleActions,
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
    const props = layerProps({ lang, onreveal });
    const { container, getByRole, unmount } = render(ExploreView, props);
    expect(container.querySelectorAll('.hotspot'), lang).toHaveLength(3);
    expect(container.querySelectorAll('.revealed'), lang).toHaveLength(0);
    await fireEvent.click(getByRole('button', { name: t(lang, 'explore.bar_reveal') }));
    expect(onreveal, lang).toHaveBeenCalledTimes(1);
    // GameSession writes the controller's 2 s outline into the store; every spot shows, the examined one marked.
    props.view.reveal = true;
    flushSync();
    const shownSpots = [...container.querySelectorAll('.hotspot')];
    expect(shownSpots.every((b) => b.classList.contains('revealed')), lang).toBe(true);
    expect(shownSpots.filter((b) => b.classList.contains('done')).map((b) => b.getAttribute('aria-label')), lang).toEqual([`${lang} inscription`]);
    expect(shownSpots.filter((b) => b.classList.contains('locked')).map((b) => b.getAttribute('aria-label')), lang).toEqual([`${lang} gate`]);
    props.view.reveal = false;
    flushSync();
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
    const props = layerProps({ lang, items: [SUN], docs: [LETTER, DIARY], panel: { kind: 'inventory' }, onread, onclose });
    const { container, getByRole, queryByRole, unmount } = render(ExploreView, props);
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
    props.view.panel = { kind: 'doc', doc: LETTER.id };
    flushSync();
    const reader = container.querySelector('.reader');
    expect(reader?.querySelector('h2')?.textContent, lang).toBe(LETTER.title);
    expect([...(reader?.querySelectorAll('p') ?? [])].map((p) => p.textContent), lang).toEqual(LETTER.body);
    await fireEvent.click(getByRole('button', { name: t(lang, 'doc.close') }));
    expect(onclose, lang).toHaveBeenCalledTimes(1);
    // Back in the inventory the document is still there, on the same tab, and reads again.
    props.view.panel = { kind: 'inventory' };
    flushSync();
    expect(container.querySelector('.reader'), lang).toBeNull();
    await fireEvent.click(getByRole('button', { name: LETTER.title }));
    expect(onread.mock.calls, lang).toEqual([['letter'], ['letter']]);
    // Empty tabs say so.
    props.view.items = [];
    props.view.docs = [];
    flushSync();
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
    const props = layerProps({ lang, items: [COIN, SUN], lock: gate(), panel: { kind: 'lock' }, oninsert });
    const { container, getByRole, queryByRole, unmount } = render(ExploreView, props);
    const slotTexts = (): string[] => [...container.querySelectorAll('.slot')].map((s) => (s.textContent ?? '').trim());
    expect(container.querySelector('.lock h2')?.textContent, lang).toBe('The gate');
    expect(slotTexts(), lang).toEqual([1, 2, 3].map(() => t(lang, 'lock.slot_empty')));
    // A wrong item: the panel asks; the controller refuses.
    await fireEvent.click(getByRole('button', { name: COIN.name }));
    expect(oninsert.mock.calls, lang).toEqual([['hall.gate', 'coin']]);
    props.view.lock = gate({ refused: true });
    flushSync();
    expect(getByRole('alert').textContent?.trim(), lang).toBe(t(lang, 'lock.no_fit'));
    expect(slotTexts(), lang).toEqual([1, 2, 3].map(() => t(lang, 'lock.slot_empty')));
    // The right item fills its slot and leaves the held list.
    await fireEvent.click(getByRole('button', { name: SUN.name }));
    expect(oninsert.mock.calls, lang).toEqual([
      ['hall.gate', 'coin'],
      ['hall.gate', 'medal_sun'],
    ]);
    props.view.lock = gate({ slots: [SUN, null, null] });
    props.view.items = [COIN];
    flushSync();
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
// GM3w: Game's layer callbacks are forwarders over the current session's yields (engine plan GM3w)

/** An ExploreLayerActions that records each call as [tag, action, ...arguments]. */
function recordingLayer(tag: string, calls: unknown[][]): ExploreLayerActions {
  return {
    ontap: (key) => {
      calls.push([tag, 'ontap', key]);
    },
    oninsert: (key, item) => {
      calls.push([tag, 'oninsert', key, item]);
    },
    oninventory: () => {
      calls.push([tag, 'oninventory']);
    },
    onread: (doc) => {
      calls.push([tag, 'onread', doc]);
    },
    onreveal: () => {
      calls.push([tag, 'onreveal']);
    },
    onclose: () => {
      calls.push([tag, 'onclose']);
    },
    onselect: (item) => {
      calls.push([tag, 'onselect', item]);
    },
    ondeselect: () => {
      calls.push([tag, 'ondeselect']);
    },
    onuse: (item, target) => {
      calls.push([tag, 'onuse', item, target]);
    },
  };
}

/** Every action once, in a fixed order, with fixed arguments. */
function callEveryAction(a: ExploreLayerActions): void {
  a.ontap(k('hall.gate'));
  a.oninsert(k('hall.gate'), 'coin' as ItemId);
  a.oninventory();
  a.onread('letter' as DocId);
  a.onreveal();
  a.onclose();
  a.onselect('coin' as ItemId);
  a.ondeselect();
  a.onuse('coin' as ItemId, k('hall.gate'));
}

/** What `callEveryAction` records on a layer tagged `tag`. */
const everyActionOn = (tag: string): unknown[][] => [
  [tag, 'ontap', 'hall.gate'],
  [tag, 'oninsert', 'hall.gate', 'coin'],
  [tag, 'oninventory'],
  [tag, 'onread', 'letter'],
  [tag, 'onreveal'],
  [tag, 'onclose'],
  [tag, 'onselect', 'coin'],
  [tag, 'ondeselect'],
  [tag, 'onuse', 'coin', 'hall.gate'],
];

test("explore-view: forwardLayer reaches the current session's layer and nothing after it ends", () => {
  const calls: unknown[][] = [];
  let current: ExploreLayerActions | undefined = recordingLayer('a', calls);
  const forward = forwardLayer(() => current);
  // One forwarder per action, no more: a lane adding an action edits the forwarder and this list.
  expect(Object.keys(forward).sort()).toEqual(['onclose', 'ondeselect', 'oninsert', 'oninventory', 'onread', 'onreveal', 'onselect', 'ontap', 'onuse']);
  callEveryAction(forward);
  expect(calls).toEqual(everyActionOn('a'));
  // A later session: the same forwarders reach its layer only (the getter runs at each call, never at creation).
  calls.length = 0;
  current = recordingLayer('b', calls);
  callEveryAction(forward);
  expect(calls).toEqual(everyActionOn('b'));
  // The session ended: every forwarder returns without a throw and reaches nothing.
  calls.length = 0;
  current = undefined;
  expect(() => callEveryAction(forward)).not.toThrow();
  expect(calls).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// The reader rules (spec 2, K26): copies of L14b's readers over every component of this directory, with an exact
// value-import list per component (cut D14).

const COMPONENT_SOURCES = import.meta.glob<string>('./*.svelte', { query: '?raw', import: 'default', eager: true });

/** Each component and the only modules it may import as values. */
const VALUE_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  './ExploreView.svelte': [
    '../../cues/root.ts',
    '../../i18n/index.ts',
    '../glyphs.ts',
    './DocumentReader.svelte',
    './Inventory.svelte',
    './LockPanel.svelte',
    './Ribbon.svelte',
  ],
  './Inventory.svelte': ['../../i18n/index.ts', '../glyphs.ts'],
  './LockPanel.svelte': ['../../i18n/index.ts', '../glyphs.ts'],
  './DocumentReader.svelte': ['../../i18n/index.ts'],
  './Ribbon.svelte': ['../../i18n/mechanics.ts', '../glyphs.ts'],
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

// ---------------------------------------------------------------------------------------------------------------
// The layer over the real cue stage (engine plan §8.5 "Cue targets", "Hit areas", the real-flush rows; GM3u): the rig of
// cues/stage/stage.svelte.test.ts, copied (RULINGS 55): a fake `Animation` on vitest's fake clock, a recording
// `Element.prototype.animate`, fixture boxes (happy-dom lays nothing out) and the real CueStage on a bus.

/** A fake `Animation` on the fake clock: finishes `ms` after its start; `currentTime` moves its start. */
class FakeAnimation {
  onfinish: (() => void) | null = null;
  playState: 'running' | 'finished' | 'idle' = 'running';
  readonly timing = { endDelay: 0 };
  readonly effect = {
    updateTiming: (t: { endDelay?: number }): void => {
      this.timing.endDelay = t.endDelay ?? this.timing.endDelay;
    },
  };
  #start = Date.now();
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #ms: number;
  constructor(ms: number) {
    this.#ms = ms;
    this.#schedule(0);
  }
  get currentTime(): number {
    return Date.now() - this.#start;
  }
  set currentTime(t: number) {
    this.#start = Date.now() - t;
    this.#schedule(t);
  }
  cancel(): void {
    this.#clear();
    this.playState = 'idle';
  }
  #clear(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
  #schedule(t: number): void {
    this.#clear();
    this.#timer = setTimeout(() => {
      this.playState = 'finished';
      this.onfinish?.();
    }, this.#ms - t);
  }
}

type Rec = { readonly el: Element; readonly kf: Keyframe[]; readonly ms: number; readonly fill: unknown; readonly anim: FakeAnimation };

const STAGE: Box = { x: 0, y: 0, w: 400, h: 600 };
const EDGE: Box = { x: 172, y: 572, w: 56, h: 56 };
const HOTSPOT: Box = { x: 40, y: 80, w: 60, h: 40 };
/** A use's target, away from the ribbon. */
const TARGET: Box = { x: 220, y: 120, w: 80, h: 60 };
const ROOT: Box = { x: 0, y: 0, w: 400, h: 600 };
/** The ribbon's slots in their order on screen: each 56 px slot's box follows from its item. */
const SLOT_ORDER = ['coin', 'medal_sun', 'key', 'gem'];
const slotBox = (item: string): Box => ({ x: 60 + 64 * SLOT_ORDER.indexOf(item), y: 480, w: 56, h: 56 });

/** Each fixture element's box; a `[data-cue-stage]` layer has the stage's box, a ribbon slot its item's. */
const BOXES = new WeakMap<Element, Box>();
const realAnimate = Element.prototype.animate;
const realRect = Element.prototype.getBoundingClientRect;
let records: Rec[] = [];
let staged = false;

function rectOf(b: Box): DOMRect {
  // The fields a DOMRect reader takes.
  return { x: b.x, y: b.y, left: b.x, top: b.y, width: b.w, height: b.h, right: b.x + b.w, bottom: b.y + b.h, toJSON: () => b } as DOMRect;
}

/** Installs the fake clock, the recording `animate` and the fixture boxes for one test; `unstage` (afterEach) undoes it. */
function stageRig(): void {
  staged = true;
  vi.useFakeTimers();
  records = [];
  Element.prototype.animate = function (this: Element, kf, opts) {
    const o = typeof opts === 'object' ? opts : { duration: opts };
    const anim = new FakeAnimation(Number(o.duration));
    // The keyframes the stage and the player pass are arrays.
    records.push({ el: this, kf: kf as Keyframe[], ms: Number(o.duration), fill: o.fill, anim });
    // The fake stands for the DOM's Animation: the stage reads `onfinish`, `currentTime`, `effect` and `cancel` only.
    return anim as unknown as Animation;
  };
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const item = this.getAttribute('data-cue-item');
    const b = this.matches('[data-cue-stage]') ? STAGE : (BOXES.get(this) ?? (item === null ? undefined : slotBox(item)));
    return b === undefined ? realRect.call(this) : rectOf(b);
  };
}

function unstage(): void {
  if (!staged) {
    return;
  }
  staged = false;
  document.body.replaceChildren();
  Element.prototype.animate = realAnimate;
  Element.prototype.getBoundingClientRect = realRect;
  vi.useRealTimers();
}

/** Lets the emitting block's flush, the stage's `tick` continuation and the observers' microtasks run. */
async function settle(): Promise<void> {
  await tick();
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

type Mounted = { readonly bus: CueBus; readonly layer: HTMLElement; readonly played: () => string[]; readonly fallbacks: () => number };

/** The real CueStage on a bus, as App mounts it from the session's slot. */
function mounted(): Mounted {
  const bus = createCueBus();
  const props: CueStageProps = {
    subscribe: bus.subscribe,
    orphans: () => bus.orphans(),
    dropped: () => {},
    reduced: false,
    host: () => null,
    haptic: { impact: () => {}, selection: () => {}, notify: () => {} },
  };
  const { container } = render(CueStage, { props });
  const layer = container.querySelector<HTMLElement>('[data-cue-stage]');
  if (layer === null) {
    throw new Error('no stage layer');
  }
  return {
    bus,
    layer,
    played: () => (layer.dataset.cuesPlayed ?? '').split(' ').filter((key) => key !== ''),
    fallbacks: () => Number(layer.dataset.cueFallbacks),
  };
}

/** The cue motions recorded (the roots' entrances and exits left out). */
const cueMotions = (): Rec[] => records.filter((r) => !r.el.matches('[data-cue-root]') && !r.el.classList.contains('cue-root-ghost'));
/** A frame without the travel the player prepends to a two-endpoint preset's transform. */
const untravelled = (f: Keyframe): Keyframe => (typeof f.transform === 'string' ? { ...f, transform: f.transform.replace(/^translate\([^)]*\)\s?/, '') } : f);
/** The cue motions that played `preset`'s keyframes (a travel's compared without its translate). */
const motionsOf = (preset: keyof typeof PRESETS): Rec[] => {
  const want = JSON.stringify(PRESETS[preset].map(untravelled));
  return cueMotions().filter((r) => JSON.stringify(r.kf.map(untravelled)) === want);
};

/** A ghost's box, from the style the stage placed it with. */
function boxOfGhost(el: Element): Box {
  const s = el instanceof HTMLElement ? el.style : null;
  return { x: parseFloat(s?.left ?? ''), y: parseFloat(s?.top ?? ''), w: parseFloat(s?.width ?? ''), h: parseFloat(s?.height ?? '') };
}

/** A hotspot as the controller writes it, at `css`. */
const spot = (key: string, kind: HotspotView['kind'], label: string, css: Box = HOTSPOT): HotspotView => ({ key: k(key), kind, label, css, done: false, locked: false });

test('explore: a hotspot is a hit area exactly while it paints nothing', () => {
  // §8.5 "Hit areas" (round 11): a hotspot that paints nothing carries `data-cue-hit`, so its element-site motion plays
  // on a painted ghost; an exit draws its glyph and a revealed hotspot its outline, so neither does.
  const props = layerProps({ hotspots: [spot('hall.to_study', 'exit', 'study door'), spot('hall.medal', 'take', 'medal')] });
  const { getByRole } = render(ExploreView, props);
  const hits = (): boolean[] => ['study door', 'medal'].map((name) => getByRole('button', { name }).hasAttribute('data-cue-hit'));
  expect(hits()).toEqual([false, true]);
  props.view.reveal = true;
  flushSync();
  expect(hits()).toEqual([false, false]);
  props.view.reveal = false;
  flushSync();
  expect(hits()).toEqual([false, true]);
});

test('explore: an exit tap presses its glyph', async () => {
  // The exit paints its glyph, so its `press` scales the button with what it paints: on the button, no ghost.
  stageRig();
  const s = mounted();
  const props = layerProps({ hotspots: [spot('hall.to_study', 'exit', 'study door')] });
  props.view.oncue = s.bus.emit;
  const { getByRole } = render(ExploreView, props);
  await settle();
  const exit = getByRole('button', { name: 'study door' });
  BOXES.set(exit, HOTSPOT);
  records = [];
  await fireEvent.click(exit);
  await settle();
  expect(s.played()).toEqual(['ui:hotspot']);
  expect(motionsOf('press').map((r) => r.el)).toEqual([exit]);
  expect(s.layer.querySelectorAll('.cue-ghost')).toHaveLength(0);
  expect(s.fallbacks()).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------
// §8.3 "Component test": every declared control emits its cue, on its own trigger

/** One control cue the layer emitted: the state it was fired in, its control, its index and its item. */
type Fired = readonly [state: string, control: string, index: number | null, item: string | null];

/** A layer state the controls are fired in: the views GameSession writes, then a tap that brings it about (a tab). */
type ControlState = { readonly name: string; readonly over: LayerOver; readonly prep?: (c: HTMLElement) => Promise<unknown> };

const GATE: LockView = { key: k('hall.gate'), title: 'The gate', locked: 'Three hollows in the iron', slots: [null, null, null], refused: false };
const CONTROL_STATES: readonly ControlState[] = [
  { name: 'rooms', over: { items: [SUN] } },
  { name: 'inventory items', over: { items: [SUN], docs: [LETTER, DIARY], panel: { kind: 'inventory' } } },
  {
    name: 'inventory files',
    over: { items: [SUN], docs: [LETTER, DIARY], panel: { kind: 'inventory' } },
    prep: (c) => fireEvent.click(c.querySelector('[data-cue="inventory-tab"][data-cue-index="1"]') ?? c),
  },
  { name: 'reader', over: { docs: [LETTER], panel: { kind: 'doc', doc: LETTER.id } } },
  { name: 'lock', over: { items: [COIN, SUN], lock: GATE, panel: { kind: 'lock' } } },
];

/** Every control a state shows a player, in document order: W1's non-vacuity, so a state that fails to render or a
 *  control that loses its marker is a missing row, never a skipped one. */
const EXPECTED_CONTROLS: readonly Fired[] = [
  ['rooms', 'hotspot', null, null],
  ['rooms', 'hotspot', null, null],
  ['rooms', 'hotspot', null, null],
  ['rooms', 'ribbon-item', null, 'medal_sun'],
  ['rooms', 'bar-inventory', null, null],
  ['rooms', 'bar-reveal', null, null],
  ['inventory items', 'inventory-tab', 0, null],
  ['inventory items', 'inventory-tab', 1, null],
  ['inventory files', 'inventory-tab', 0, null],
  ['inventory files', 'inventory-tab', 1, null],
  ['inventory files', 'inventory-doc', null, null],
  ['inventory files', 'inventory-doc', null, null],
  ['reader', 'doc-close', null, null],
  ['lock', 'lock-item', null, 'coin'],
  ['lock', 'lock-item', null, 'medal_sun'],
];

/** The controls a player can tap now: every `[data-cue]` element outside an inert subtree, in document order. */
const liveControls = (c: Element): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('[data-cue]')].filter((el) => el.closest('[inert]') === null);

/** Fires a control's declared trigger: a click, else a bare event of its type (the root reads only the event's type). */
async function fire(el: HTMLElement): Promise<void> {
  const on = el.dataset.cueOn ?? 'click';
  await (on === 'click' ? fireEvent.click(el) : fireEvent(el, new Event(on, { bubbles: true })));
}

/** The layer in `state`, its root emitting into `cues` (cleared after the state's own taps). */
async function openState(state: ControlState): Promise<{ container: HTMLElement; cues: CueEvent[]; unmount: () => void }> {
  const cues: CueEvent[] = [];
  const props = layerProps(state.over);
  props.view.oncue = (e) => cues.push(e);
  const { container, unmount } = render(ExploreView, props);
  await tick();
  await state.prep?.(container);
  cues.length = 0;
  return { container, cues, unmount };
}

test('explore: every declared control emits its cue', async () => {
  const fired: Fired[] = [];
  for (const state of CONTROL_STATES) {
    const first = await openState(state);
    const count = liveControls(first.container).length;
    first.unmount();
    // A fresh layer per control: a fired control may change the state (a tab), never what the next one is fired in.
    for (let i = 0; i < count; i += 1) {
      const { container, cues, unmount } = await openState(state);
      const el = liveControls(container)[i];
      if (el === undefined) {
        throw new Error(`invariant: ${state.name} shows ${count} controls`);
      }
      await fire(el);
      // Exactly one cue per control, from the control itself.
      expect(cues.map((e) => [e.cue.kind, e.el]), `${state.name} #${i}`).toEqual([['ui', el]]);
      for (const { cue } of cues) {
        if (cue.kind === 'ui') {
          fired.push([state.name, cue.control, cue.index, cue.item]);
        }
      }
      unmount();
    }
  }
  expect(fired).toEqual(EXPECTED_CONTROLS);
  // A `pointerdown` control (GM8b's `push`; none in the explore UI yet, so a fixture inside the root, M-I5g): it emits on
  // its declared trigger, with its index, and a click on it emits nothing.
  const cues: CueEvent[] = [];
  const props = layerProps();
  props.view.oncue = (e) => cues.push(e);
  const { container } = render(ExploreView, props);
  await tick();
  const push = document.createElement('button');
  Object.assign(push.dataset, { cue: 'dial-up', cueOn: 'pointerdown', cueIndex: '3' });
  container.querySelector('[data-cue-root]')?.append(push);
  await fire(push);
  await fireEvent.click(push);
  expect(cues.map((e) => [e.cue, e.el])).toEqual([[{ kind: 'ui', control: 'dial-up', item: null, index: 3 }, push]]);
});

// ---------------------------------------------------------------------------------------------------------------
// The ribbon (engine plan §6.1 UI, §8.1 point 9; GM3u): the held items, the selection, the use dispatch, and the
// real-flush rows of §8.5 "Cue targets" (08c) for a take and a use

const KEY: ItemView = { id: 'key' as ItemId, name: 'Iron key', desc: 'Heavy', glyph: 'key' };
const GEM: ItemView = { id: 'gem' as ItemId, name: 'Star gem', desc: 'Cold', glyph: 'star' };

/** The live ribbon's slot of `item`, or null. */
const slotOf = (item: ItemView): HTMLElement | null => document.querySelector(`[data-cue-ribbon] [data-cue-item="${item.id}"]`);

/** A fact cue as yields emits it, on `box`. */
function factEvent(kind: FactKind, id: string, change: 'added' | 'removed', cause: Cause, box: Box | null): CueEvent {
  return { cue: { kind: 'fact', fact: { kind, id }, change, cause }, box, point: null, diff: [], el: null };
}

test('explore: selecting an item then tapping a target dispatches use', async () => {
  // §6.1 UI: a ribbon slot selects its item; a hotspot tapped while an item is selected uses it there instead of a tap.
  const ontap = vi.fn<(key: HotspotKey) => void>();
  const onuse = vi.fn<(item: ItemId, target: HotspotKey) => void>();
  const onselect = vi.fn<(item: ItemId) => void>();
  const ondeselect = vi.fn();
  const props = layerProps({ items: [COIN, SUN], ontap, onuse, onselect, ondeselect });
  const { container, getByRole } = render(ExploreView, props);
  // Each held item is a labelled slot showing its glyph, none pressed.
  expect([slotOf(COIN), slotOf(SUN)].map((el) => [el?.getAttribute('aria-label'), el?.getAttribute('aria-pressed'), el === null ? [] : glyphsIn(el)])).toEqual([
    [COIN.name, 'false', [GLYPH_PATHS.coin]],
    [SUN.name, 'false', [GLYPH_PATHS.sun]],
  ]);
  await fireEvent.click(slotOf(SUN) ?? container);
  expect(onselect.mock.calls).toEqual([['medal_sun']]);
  // GameSession writes the selection: the slot is pressed, and a tap on a hotspot uses the item there.
  props.view.selected = SUN.id;
  flushSync();
  expect([slotOf(COIN), slotOf(SUN)].map((el) => el?.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  await fireEvent.click(getByRole('button', { name: 'en gate' }));
  expect(onuse.mock.calls).toEqual([['medal_sun', 'hall.gate']]);
  expect(ontap).not.toHaveBeenCalled();
  // The pressed slot again deselects; with no selection a hotspot taps again.
  await fireEvent.click(slotOf(SUN) ?? container);
  expect([onselect.mock.calls.length, ondeselect.mock.calls.length]).toEqual([1, 1]);
  props.view.selected = null;
  flushSync();
  await fireEvent.click(getByRole('button', { name: 'en gate' }));
  expect(ontap.mock.calls).toEqual([['hall.gate']]);
  expect(onuse).toHaveBeenCalledTimes(1);
  // A panel covers the rooms: no ribbon under it.
  props.view.panel = { kind: 'inventory' };
  flushSync();
  expect(container.querySelector('[data-cue-ribbon]')).toBeNull();
});

test('explore: a take pulses the slot it creates and presses the hotspot it removes on its ghost', async () => {
  // 08c's take row: a real click on a take hotspot (the root emits `ui:hotspot`), then the take's writes (the item into
  // the ribbon, the hotspot out of the room) and its `fact:held:added`, (i) in the click's own block and (ii) in the
  // intent's microtask, as Game runs a tap.
  for (const when of ['click', 'microtask'] as const) {
    stageRig();
    const s = mounted();
    const medal = spot('study.medal', 'take', 'medal on the shelf');
    const cause = { verb: 'tap', at: medal.key, item: null, via: null } as const;
    const props: ExploreLayerProps = layerProps({
      hotspots: [medal],
      ontap: () => {
        const take = (): void => {
          props.view.items = [SUN];
          props.view.hotspots = [];
          s.bus.emit(factEvent('held', SUN.id, 'added', cause, HOTSPOT));
        };
        if (when === 'click') {
          take();
        } else {
          queueMicrotask(take);
        }
      },
    });
    props.view.oncue = s.bus.emit;
    const { getByRole } = render(ExploreView, props);
    await settle();
    const button = getByRole('button', { name: 'medal on the shelf' });
    BOXES.set(button, HOTSPOT);
    records = [];
    await fireEvent.click(button);
    await settle();
    const slot = slotOf(SUN);
    expect([slot === null, button.isConnected], when).toEqual([false, false]);
    // The press: on the hotspot's painted ghost from the tap (a hit area paints nothing), at the button's box.
    const presses = motionsOf('press');
    expect(presses.map((r) => [r.el.classList.contains('cue-ghost'), r.el.classList.contains('cue-hit'), r.el.getAttribute('aria-label')]), when).toEqual([
      [true, true, 'medal on the shelf'],
    ]);
    expect(presses.map((r) => boxOfGhost(r.el)), when).toEqual([HOTSPOT]);
    // The fly ends on the new slot (a travelling clone of it at its box); the slot's pulse plays on the slot itself.
    const flies = motionsOf('fly');
    expect(flies.map((r) => [r.el.classList.contains('cue-ghost'), r.el.getAttribute('aria-label'), boxOfGhost(r.el)]), when).toEqual([[true, SUN.name, slotBox(SUN.id)]]);
    expect(motionsOf('pulse').map((r) => r.el), when).toEqual([slot]);
    expect([s.played(), s.fallbacks()], when).toEqual([['ui:hotspot', 'fact:held:added'], 0]);
    // No ghost outlives its motion.
    vi.advanceTimersByTime(480);
    expect(s.layer.querySelectorAll('.cue-ghost'), when).toHaveLength(0);
    cleanup();
    unstage();
  }
});

test('explore: a take whose then starts a knot flies its glyph to the edge as the rooms leave', async () => {
  // 08c's sixth row: the take's writes and cues, then the knot hides the rooms in the same block (App's explore `{#if}`
  // turns false; Svelte's `unmount` stands for it). The ribbon is live at the emit and gone at the flush: the glyph
  // flies to the designed `edge` landing, which counts nothing.
  stageRig();
  const s = mounted();
  const medal = spot('study.medal', 'take', 'medal on the shelf');
  const cause = { verb: 'tap', at: medal.key, item: null, via: null } as const;
  let view: ReturnType<typeof mount> | null = null;
  const props: ExploreLayerProps = layerProps({
    hotspots: [medal],
    ontap: () => {
      props.view.items = [SUN];
      props.view.hotspots = [];
      s.bus.emit(factEvent('taken', medal.key, 'added', cause, HOTSPOT));
      s.bus.emit(factEvent('held', SUN.id, 'added', cause, HOTSPOT));
      s.bus.emit(factEvent('story', 'study_voice', 'added', cause, HOTSPOT));
      if (view !== null) {
        void unmount(view);
      }
    },
  });
  props.view.oncue = s.bus.emit;
  view = mount(ExploreView, { target: document.body, props });
  await settle();
  const root = document.querySelector('[data-cue-root]');
  const button = document.querySelector<HTMLElement>('.hotspot');
  if (root === null || button === null) {
    throw new Error('invariant: the layer is mounted');
  }
  BOXES.set(root, ROOT);
  BOXES.set(button, HOTSPOT);
  // The ribbon is live before the take.
  expect(document.querySelector('[data-cue-ribbon]')).not.toBeNull();
  vi.advanceTimersByTime(LAYER_MOTIONS.in.ms);
  records = [];
  await fireEvent.click(button);
  await settle();
  // The rooms left at the flush: their ghost is inert and plays `layer-out`.
  expect(document.querySelector('[data-cue-root]')).toBeNull();
  const rootGhost = s.layer.querySelector('.cue-root-ghost');
  expect(rootGhost?.hasAttribute('inert')).toBe(true);
  expect(records.filter((r) => r.el === rootGhost).map((r) => r.kf)).toEqual([LAYER_MOTIONS.out.keyframes]);
  // The fly ends on the edge on a plain ghost; the slot's pulse has no slot and is skipped.
  expect(motionsOf('fly').map((r) => [r.el.classList.contains('cue-plain'), boxOfGhost(r.el)])).toEqual([[true, EDGE]]);
  expect(motionsOf('pulse')).toEqual([]);
  // The glint at the emptied box; the press on the hotspot's own painted ghost, outside the rooms' ghost.
  expect(motionsOf('glint').map((r) => boxOfGhost(r.el))).toEqual([HOTSPOT]);
  expect(motionsOf('press').map((r) => [r.el.classList.contains('cue-hit'), r.el.closest('.cue-root-ghost')])).toEqual([[true, null]]);
  expect([s.played(), s.fallbacks()]).toEqual([['ui:hotspot', 'fact:taken:added', 'fact:held:added', 'fact:story:added'], 0]);
  vi.advanceTimersByTime(600);
  expect(s.layer.querySelectorAll('.cue-ghost')).toHaveLength(0);
});

test('explore: a use settles its leaving slot on its ghost and pulses the slot its rule gives', async () => {
  // 08c's use row: three items held, the middle one selected; a tap on a target uses it (`onuse`), and the block is what
  // yields writes and emits for a use with `keep: false` and `do: [{ give }]`, in its order: the deselect, then the
  // rule's writes with their cues.
  stageRig();
  const s = mounted();
  const desk = spot('study.desk', 'object', 'the desk', TARGET);
  const props: ExploreLayerProps = layerProps({
    hotspots: [desk],
    items: [COIN, SUN, KEY],
    selected: SUN.id,
    onuse: (item, target) => {
      const cause = { verb: 'use', at: target, item, via: null } as const;
      props.view.selected = null;
      s.bus.emit({ cue: { kind: 'ui-state', name: 'deselect', panel: null, item }, box: null, point: null, diff: [], el: null });
      props.view.items = [COIN, KEY, GEM];
      s.bus.emit(factEvent('held', item, 'removed', cause, TARGET));
      s.bus.emit(factEvent('used', item, 'added', cause, TARGET));
      s.bus.emit(factEvent('held', GEM.id, 'added', cause, TARGET));
    },
  });
  props.view.oncue = s.bus.emit;
  const { getByRole } = render(ExploreView, props);
  await settle();
  BOXES.set(getByRole('button', { name: 'the desk' }), TARGET);
  records = [];
  await fireEvent.click(getByRole('button', { name: 'the desk' }));
  await settle();
  expect([slotOf(SUN), slotOf(GEM) === null]).toEqual([null, false]);
  /** What a ghost shows: its label and its glyph, at its box. */
  const shown = (r: Rec): unknown[] => [r.el.classList.contains('cue-ghost'), r.el.getAttribute('aria-label'), glyphsIn(r.el), boxOfGhost(r.el)];
  const sun = [true, SUN.name, [GLYPH_PATHS.sun], slotBox(SUN.id)];
  // The deselect's and the leaving item's `settle` on clones of the middle slot at its captured box.
  expect(motionsOf('settle').map(shown)).toEqual([sun, sun]);
  // The slot flies back to the target and drops there: both from the middle slot's box toward the target's.
  const toward = (r: Rec | undefined): string => String(r?.kf.at(-1)?.transform ?? '');
  const [back] = motionsOf('fly-back');
  const [drop] = motionsOf('drop');
  const d = { x: TARGET.x + TARGET.w / 2 - (slotBox(SUN.id).x + 28), y: TARGET.y + TARGET.h / 2 - (slotBox(SUN.id).y + 28) };
  expect([back, drop].map((r) => (r === undefined ? null : shown(r)))).toEqual([sun, sun]);
  expect([toward(back), toward(drop)].map((t) => t.startsWith(`translate(${d.x}px, ${d.y}px)`))).toEqual([true, true]);
  // The given item flies to its new slot and pulses there.
  expect(motionsOf('fly').map(shown)).toEqual([[true, GEM.name, [GLYPH_PATHS.star], slotBox(GEM.id)]]);
  expect(motionsOf('pulse').map((r) => r.el)).toEqual([slotOf(GEM)]);
  expect([s.played(), s.fallbacks()]).toEqual([['ui:hotspot', 'ui-state:deselect', 'fact:held:removed', 'fact:used:added', 'fact:held:added'], 0]);
  vi.advanceTimersByTime(480);
  expect(s.layer.querySelectorAll('.cue-ghost')).toHaveLength(0);
});

test("explore: a use that fills a lock slot drops from the item's ribbon slot", async () => {
  // GM3's carry (its cut Q8 O5): `fact:slot:added` names the lock, so the stage finds the item's slot by the cue's
  // cause; the item leaves the ribbon in the same block, so the drop plays on its slot's clone at the captured box.
  stageRig();
  const s = mounted();
  const gate = spot('hall.gate', 'exit', 'the gate', TARGET);
  const props: ExploreLayerProps = layerProps({
    hotspots: [gate],
    items: [COIN, SUN],
    selected: SUN.id,
    onuse: (item, target) => {
      props.view.selected = null;
      props.view.items = [COIN];
      s.bus.emit(factEvent('slot', target, 'added', { verb: 'use', at: target, item, via: null }, TARGET));
    },
  });
  props.view.oncue = s.bus.emit;
  const { getByRole } = render(ExploreView, props);
  await settle();
  BOXES.set(getByRole('button', { name: 'the gate' }), TARGET);
  records = [];
  await fireEvent.click(getByRole('button', { name: 'the gate' }));
  await settle();
  expect(motionsOf('drop').map((r) => [r.el.classList.contains('cue-ghost'), r.el.getAttribute('aria-label'), boxOfGhost(r.el)])).toEqual([
    [true, SUN.name, slotBox(SUN.id)],
  ]);
  expect([s.played(), s.fallbacks()]).toEqual([['ui:hotspot', 'fact:slot:added'], 0]);
});

/**
 * The mechanics' string table, read through a glob rather than an import (critique W2): where the table is absent the
 * glob is empty, so only the parity test is red and the file's other tests keep their own reds (Vite's import analysis
 * refuses an unresolvable `import()` literal for the whole file).
 */
const MECHANICS_TABLES = import.meta.glob<typeof import('../../i18n/mechanics.ts')>('../../i18n/mechanics.ts', { eager: true });

test('mechanics: both string tables hold the same keys and placeholders', () => {
  const table = MECHANICS_TABLES['../../i18n/mechanics.ts'];
  if (table === undefined) {
    throw new Error('no mechanics string table at ../../i18n/mechanics.ts');
  }
  const { mechanicsEn, mechanicsRu, mechT } = table;
  const keys = Object.keys(mechanicsRu) as Array<keyof typeof mechanicsRu>;
  expect([...keys].sort()).toEqual(['mech.ribbon', 'mech.use_refused']);
  expect(Object.keys(mechanicsEn).sort()).toEqual([...keys].sort());
  const placeholders = (text: string): string[] => [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1] ?? '').sort();
  for (const key of keys) {
    expect([mechanicsRu[key].trim(), mechanicsEn[key].trim()].map((x) => x !== ''), key).toEqual([true, true]);
    expect(placeholders(mechanicsEn[key]), key).toEqual(placeholders(mechanicsRu[key]));
    expect([mechT('ru', key), mechT('en', key)], key).toEqual([mechanicsRu[key], mechanicsEn[key]]);
  }
  // Russian belongs in the Russian table: the English one holds none.
  expect(Object.values(mechanicsEn).filter((v) => /\p{Script=Cyrillic}/u.test(v))).toEqual([]);
});
