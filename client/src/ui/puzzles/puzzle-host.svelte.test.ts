// LP2 in happy-dom: the puzzle frame and the hint ladder (PUZZLES-PLAN X8, X14, X18; META-PLAN M21, M27, F24), the
// view store's BackButton rule, and the reader rules over the four puzzle components (no literal text, no I/O). Events
// are built by hand where it matters: a raw tap is pointerdown + click with the DOM not yet updated (a double tap).
import { cleanup, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';

import { t } from '../../i18n/index.ts';
import type { Lang } from '../../i18n/index.ts';
import CodeLock from '../../puzzles/ui/CodeLock.svelte';
import type { HintTierView } from '../../puzzles/session.ts';
import { backScreen, createPuzzleView } from '../puzzle-view.svelte.ts';
import type { HintLadderUiView, PuzzleFrameView, PuzzleHostProps } from '../puzzle-view.svelte.ts';
import HintLadder from './HintLadder.svelte';
import PuzzleHost from './PuzzleHost.svelte';

// svelteTesting()'s auto-cleanup does not reach the `dom` project (L14a), so each test unmounts what it rendered here.
afterEach(() => cleanup());

const LANGS: readonly Lang[] = ['ru', 'en'];

const down = (el: Element): void => {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
};
const pointerClick = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
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
const names = (els: Iterable<Element>): string[] => [...els].map(shown);

function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) {
    throw new Error(`expected ${what}`);
  }
  return v;
}

function frameOf(over: Partial<PuzzleFrameView> = {}): PuzzleFrameView {
  return {
    id: 1,
    mode: 'linear',
    type: 'code',
    title: 'The cabinet',
    prompt: 'Four digits',
    params: { dials: 4 },
    answer: [0, 0, 0, 0],
    busy: false,
    line: 'idle',
    attemptsLeft: null,
    retryAfter: null,
    giveUp: true,
    hintTiers: 3,
    ui: CodeLock,
    loadFailed: false,
    ...over,
  };
}

function hostProps(over: Partial<PuzzleHostProps> = {}): PuzzleHostProps {
  return {
    lang: 'en',
    frame: frameOf(),
    ladder: null,
    item: () => null,
    onchange: vi.fn(),
    ontry: vi.fn(),
    ongiveup: vi.fn(),
    onhint: vi.fn(),
    onretry: vi.fn(),
    onusehint: vi.fn(),
    ongetmore: vi.fn(),
    ...over,
  };
}

/** The give-up area's blocks, top to bottom: their text and their buttons. */
const giveUpBlocks = (root: Element): Array<{ text: string; buttons: string[] }> =>
  [...root.querySelectorAll('.give-up > .actions')].map((b) => ({ text: shown(b), buttons: names(b.querySelectorAll('button')) }));

test('puzzle host: linear has give up and no back', () => {
  for (const lang of LANGS) {
    const ongiveup = vi.fn();
    const { container, unmount } = render(PuzzleHost, hostProps({ lang, ongiveup }));
    const giveUp = t(lang, 'puzzle.give_up');
    const ask = t(lang, 'puzzle.give_up_confirm');
    const yes = t(lang, 'puzzle.give_up_yes');
    const no = t(lang, 'saves.no');
    expect(giveUpBlocks(container), lang).toEqual([{ text: giveUp, buttons: [giveUp] }]);
    // A raw double tap on Give up meets the question or No, never Yes (RULINGS 60, I1).
    const giveUpButton = must(container.querySelector('.give-up button'), 'the Give up button');
    rawTap(giveUpButton);
    rawTap(giveUpButton);
    flushSync();
    expect(ongiveup, lang).not.toHaveBeenCalled();
    // The question and No fill the block that held Give up; Yes has a block of its own below it.
    expect(giveUpBlocks(container), lang).toEqual([
      { text: `${ask} ${no}`, buttons: [no] },
      { text: yes, buttons: [yes] },
    ]);
    // No drops the question.
    const blockButton = (i: number): Element => must(container.querySelectorAll('.give-up > .actions')[i]?.querySelector('button'), `a button in block ${i}`);
    tap(blockButton(0));
    expect(giveUpBlocks(container), lang).toEqual([{ text: giveUp, buttons: [giveUp] }]);
    expect(ongiveup, lang).not.toHaveBeenCalled();
    // Yes gives up once, however often it is tapped.
    tap(blockButton(0));
    const yesButton = blockButton(1);
    rawTap(yesButton);
    rawTap(yesButton);
    flushSync();
    expect(ongiveup, lang).toHaveBeenCalledTimes(1);
    unmount();
  }
  // An exploration puzzle, or a linear one without giveUp, offers no Give up.
  for (const frame of [frameOf({ mode: 'explore' }), frameOf({ giveUp: false }), frameOf({ line: 'solved' })]) {
    const { container, unmount } = render(PuzzleHost, hostProps({ frame }));
    expect(container.querySelector('.give-up'), `${frame.mode} ${String(frame.giveUp)} ${frame.line}`).toBeNull();
    expect(names(container.querySelectorAll('button'))).not.toContain(t('en', 'puzzle.give_up'));
    unmount();
  }
  // No BackButton for a linear puzzle: it is a mode, not an overlay (X8); an exploration puzzle closes with it.
  expect(backScreen(frameOf({ mode: 'linear' }))).toBeNull();
  expect(backScreen(frameOf({ mode: 'explore' }))).toEqual({ kind: 'puzzle' });
});

test('puzzle host: unmount on end', async () => {
  const digits = (root: Element): string[] => names(root.querySelectorAll('.digit'));
  const onchange = vi.fn();
  const { container, getAllByRole, queryAllByRole, rerender } = render(PuzzleHost, hostProps({ frame: frameOf({ id: 1, answer: [1, 2, 3, 4] }), onchange }));
  expect(shown(container)).toContain('The cabinet');
  expect(shown(container)).toContain('Four digits');
  expect(digits(container)).toEqual(['1', '2', '3', '4']);
  const firstUp = getAllByRole('button', { name: t('en', 'puzzle.dial_up') })[0];
  // The type UI's changes reach GameSession through the host.
  tap(must(firstUp, 'a dial'));
  expect(onchange.mock.calls).toEqual([[[2, 2, 3, 4]]]);
  // The session ended: nothing of the puzzle stays in the DOM.
  await rerender({ frame: null });
  expect(digits(container)).toEqual([]);
  expect(queryAllByRole('button')).toEqual([]);
  expect(shown(container)).toBe('');
  // A new session re-mounts the type UI with its answer.
  await rerender({ frame: frameOf({ id: 2, answer: [5, 6, 7, 8] }) });
  expect(digits(container)).toEqual(['5', '6', '7', '8']);
  const secondUp = getAllByRole('button', { name: t('en', 'puzzle.dial_up') })[0];
  expect(secondUp).not.toBe(firstUp);
  // The same session's next answer updates in place.
  await rerender({ frame: frameOf({ id: 2, answer: [0, 0, 0, 1] }) });
  expect(digits(container)).toEqual(['0', '0', '0', '1']);
  expect(getAllByRole('button', { name: t('en', 'puzzle.dial_up') })[0]).toBe(secondUp);
  // While the chunk loads nothing is actionable but Hint; a failed load offers Retry.
  await rerender({ frame: frameOf({ id: 3, ui: null }) });
  expect(digits(container)).toEqual([]);
  expect((getAllByRole('button', { name: t('en', 'puzzle.try') })[0] as HTMLButtonElement | undefined)?.disabled).toBe(true);
  const onretry = vi.fn();
  await rerender({ frame: frameOf({ id: 3, ui: null, loadFailed: true }), onretry });
  expect(shown(container)).toContain(t('en', 'puzzle.load_failed'));
  tap(must(getAllByRole('button', { name: t('en', 'puzzle.retry') })[0], 'Retry'));
  expect(onretry).toHaveBeenCalledTimes(1);
  // The view store starts empty; GameSession fills it (the host component arrives through yields.ts's import()).
  const view = createPuzzleView();
  expect([view.host, view.frame, view.ladder]).toEqual([null, null, null]);
  view.host = PuzzleHost;
  view.frame = frameOf();
  expect(view.host).toBe(PuzzleHost);
});

test('puzzle host: status line, attempts and try', async () => {
  const ontry = vi.fn();
  const onhint = vi.fn();
  const { container, getByRole, rerender } = render(PuzzleHost, hostProps({ ontry, onhint, frame: frameOf({ attemptsLeft: 2 }) }));
  const status = (): string => shown(must(container.querySelector('[role="status"]'), 'the status line'));
  const tryButton = (): HTMLButtonElement => getByRole('button', { name: t('en', 'puzzle.try') }) as HTMLButtonElement;
  expect(shown(container)).toContain(t('en', 'puzzle.attempts_left', { n: 2 }));
  tap(tryButton());
  expect(ontry).toHaveBeenCalledTimes(1);
  tap(getByRole('button', { name: t('en', 'puzzle.hint') }));
  expect(onhint).toHaveBeenCalledTimes(1);
  const lines: ReadonlyArray<readonly [PuzzleFrameView['line'], string, boolean]> = [
    ['checking', t('en', 'puzzle.checking'), true],
    ['wrong', t('en', 'puzzle.wrong'), false],
    ['offline', t('en', 'puzzle.offline'), false],
    ['solved', t('en', 'puzzle.solved'), true],
    ['failed', t('en', 'puzzle.failed'), true],
  ];
  for (const [line, text, closed] of lines) {
    await rerender({ frame: frameOf({ line, busy: line === 'checking' }) });
    expect(status(), line).toBe(text);
    expect(tryButton().disabled, line).toBe(closed);
  }
  // A 429: Try waits out the server's seconds, counted down by GameSession.
  await rerender({ frame: frameOf({ line: 'rate-limited', retryAfter: 17 }) });
  expect(status()).toBe(t('en', 'puzzle.rate_limited', { s: 17 }));
  expect(tryButton().disabled).toBe(true);
  await rerender({ frame: frameOf({ line: 'rate-limited', retryAfter: 0 }) });
  expect(tryButton().disabled).toBe(false);
  // No hint tiers, no Hint button.
  await rerender({ frame: frameOf({ hintTiers: 0 }) });
  expect(names(container.querySelectorAll('button'))).not.toContain(t('en', 'puzzle.hint'));
});

const ladderOf = (tiers: readonly HintTierView[], wallet: HintLadderUiView['wallet'], over: Partial<HintLadderUiView> = {}): HintLadderUiView => ({
  tiers,
  wallet,
  busy: false,
  failed: false,
  ...over,
});

const TIERS: readonly HintTierView[] = [
  { tier: 1, text: 'Look under the rug', state: 'unlocked' },
  { tier: 2, text: null, state: 'usable' },
  { tier: 3, text: null, state: 'locked' },
];

test('hint ladder: no port shows no use button', async () => {
  for (const lang of LANGS) {
    const onuse = vi.fn();
    const ongetmore = vi.fn();
    const { container, queryAllByRole, getAllByRole, rerender, unmount } = render(HintLadder, { lang, ladder: ladderOf(TIERS, null), onuse, ongetmore });
    // No port (L15): the unlocked text shows; nothing to use, no balance, no get more.
    expect(queryAllByRole('button'), lang).toEqual([]);
    expect(shown(container), lang).toContain('Look under the rug');
    expect(shown(container), lang).toContain(t(lang, 'hint.tier', { n: 1 }));
    expect(container.querySelector('.balance'), lang).toBeNull();
    // A wallet that can pay: exactly one use button with the cost, and the balance.
    await rerender({ ladder: ladderOf(TIERS, { cost: 1, balance: 2 }) });
    expect(names(getAllByRole('button')), lang).toEqual([t(lang, 'hint.use', { n: 1 })]);
    expect(shown(container), lang).toContain(t(lang, 'hint.balance', { n: 2 }));
    tap(must(getAllByRole('button')[0], 'a button'));
    expect(onuse.mock.calls, lang).toEqual([[2]]);
    // Below the cost: get more instead of the use button.
    await rerender({ ladder: ladderOf(TIERS, { cost: 1, balance: 0 }) });
    expect(names(getAllByRole('button')), lang).toEqual([t(lang, 'hint.get_more')]);
    tap(must(getAllByRole('button')[0], 'a button'));
    expect(ongetmore, lang).toHaveBeenCalledTimes(1);
    // An unknown cost or balance (the wallet has not answered yet) offers neither, and never a raw placeholder.
    for (const wallet of [{ cost: null, balance: 2 }, { cost: 1, balance: null }, { cost: null, balance: null }]) {
      await rerender({ ladder: ladderOf(TIERS, wallet) });
      expect(queryAllByRole('button'), `${lang} ${JSON.stringify(wallet)}`).toEqual([]);
      expect(shown(container), lang).not.toContain('{n}');
    }
    // A use in flight disables the button; a failed use says so.
    await rerender({ ladder: ladderOf(TIERS, { cost: 1, balance: 2 }, { busy: true, failed: true }) });
    expect((getAllByRole('button')[0] as HTMLButtonElement | undefined)?.disabled, lang).toBe(true);
    expect(shown(must(container.querySelector('[role="alert"]'), 'the alert')), lang).toBe(t(lang, 'hint.failed'));
    // Solved: the rest is unavailable, nothing to use or get.
    const solved: HintTierView[] = [TIERS[0] ?? { tier: 1, text: null, state: 'unlocked' }, { tier: 2, text: null, state: 'unavailable' }];
    await rerender({ ladder: ladderOf(solved, { cost: 1, balance: 0 }) });
    expect(queryAllByRole('button'), lang).toEqual([]);
    expect(shown(container), lang).toContain(t(lang, 'hint.unavailable'));
    unmount();
  }
  // The frame renders the ladder while it is set, and routes its use to GameSession.
  const onusehint = vi.fn();
  const host = render(PuzzleHost, hostProps({ ladder: ladderOf(TIERS, { cost: 1, balance: 2 }), onusehint }));
  expect(shown(host.container)).toContain(t('en', 'hint.title'));
  tap(host.getByRole('button', { name: t('en', 'hint.use', { n: 1 }) }));
  expect(onusehint.mock.calls).toEqual([[2]]);
  await host.rerender({ ladder: null });
  expect(shown(host.container)).not.toContain(t('en', 'hint.title'));
});

// ---------------------------------------------------------------------------------------------------------------
// The reader rules (spec 2, K26): copies of L14b's readers (menus.svelte.test.ts; RULINGS 55 accepts copies) over the
// four puzzle components, with an exact import list per component (critique W2): a value import beyond it, such as
// the Telegram facade, is an offender.

const COMPONENT_SOURCES = import.meta.glob<string>(['./*.svelte', '../../puzzles/ui/*.svelte'], { query: '?raw', import: 'default', eager: true });

/** Each component and the only modules it may import as values. */
const VALUE_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  './PuzzleHost.svelte': ['../../i18n/index.ts', './HintLadder.svelte'],
  './HintLadder.svelte': ['../../i18n/index.ts'],
  '../../puzzles/ui/CodeLock.svelte': ['../../i18n/index.ts', '../rules/index.ts'],
  '../../puzzles/ui/OrderPuzzle.svelte': ['../../i18n/index.ts', '../rules/index.ts'],
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

test('puzzle ui: components hold no literal text', () => {
  // Non-vacuous: exactly the four components are read.
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
 * listeners outside Svelte's own `on…` attributes. Dialogs and window.open are arch's rules.
 */
const IO_NAMES =
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator|window|globalThis|document|location|indexedDB|postMessage|setTimeout|setInterval|requestAnimationFrame|queueMicrotask|addEventListener)\b/g;

/** A source without its comments (HTML, block and line comments). */
const withoutComments = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');

test('puzzle ui: components do no I/O', () => {
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
