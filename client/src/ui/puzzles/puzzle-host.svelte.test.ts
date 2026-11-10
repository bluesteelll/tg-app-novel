// LP2 in happy-dom: the puzzle frame and the hint ladder (PUZZLES-PLAN X8, X14, X18; META-PLAN M21, M27, F24), the
// view store's BackButton rule, and the reader rules over the four puzzle components (no literal text, no I/O). Events
// are built by hand where it matters: a raw tap is pointerdown + click with the DOM not yet updated (a double tap).
import { cleanup, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';

import type { CueEvent } from '../../cues/types.ts';
import { t } from '../../i18n/index.ts';
import type { Lang } from '../../i18n/index.ts';
import CodeLock from '../../puzzles/ui/CodeLock.svelte';
import OrderPuzzle from '../../puzzles/ui/OrderPuzzle.svelte';
import type { HintTierView } from '../../puzzles/session.ts';
import type { ItemId } from '../../world/types.ts';
import { backScreen, coversStage, createPuzzleView, forwardHost } from '../puzzle-view.svelte.ts';
import type { HintLadderUiView, PuzzleFrameView, PuzzleHostCallbacks, PuzzleHostProps } from '../puzzle-view.svelte.ts';
import appSource from '../App.svelte?raw';
import HintLadder from './HintLadder.svelte';
import PuzzleHost from './PuzzleHost.svelte';
import puzzleHostSource from './PuzzleHost.svelte?raw';

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
    retrying: false,
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

test('puzzle-host: the status line is a cue target', () => {
  // Engine plan §8.5 "Cue targets" (`status`): the status line, and only it, carries the marker the frame's
  // `puzzle:checking` / `wrong` / `offline` / `rate-limited` / `ready` rows land on.
  const { container } = render(PuzzleHost, hostProps({ frame: frameOf({ line: 'checking', busy: true }) }));
  const marked = [...container.querySelectorAll('[data-cue-status]')];
  expect(marked.map((el) => el.getAttribute('role'))).toEqual(['status']);
  expect(shown(must(marked[0], 'the status line'))).toBe(t('en', 'puzzle.checking'));
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
// GM3w: Game's host callbacks are forwarders over the current session's yields, and the frame's cover rule (engine
// plan GM3w)

/** A PuzzleHostCallbacks that records each call as [tag, callback, ...arguments]; `item` names a piece after `tag`. */
function recordingHost(tag: string, calls: unknown[][]): PuzzleHostCallbacks {
  return {
    item: (id) => {
      calls.push([tag, 'item', id]);
      return { name: `${tag} ${id}`, glyph: 'sun' };
    },
    onchange: (a) => {
      calls.push([tag, 'onchange', a]);
    },
    ontry: () => {
      calls.push([tag, 'ontry']);
    },
    ongiveup: () => {
      calls.push([tag, 'ongiveup']);
    },
    onhint: () => {
      calls.push([tag, 'onhint']);
    },
    onretry: () => {
      calls.push([tag, 'onretry']);
    },
    onusehint: (tier) => {
      calls.push([tag, 'onusehint', tier]);
    },
    ongetmore: () => {
      calls.push([tag, 'ongetmore']);
    },
    oncue: (e) => {
      calls.push([tag, 'oncue', keyOfCue(e)]);
    },
  };
}

/** A recorded cue: its kind and control (the forwarders hand the event on unchanged). */
const keyOfCue = (e: CueEvent): string => (e.cue.kind === 'ui' ? `ui:${e.cue.control}` : e.cue.kind);

/** The cue `callEveryCallback` hands `oncue`. */
const TRY_CUE: CueEvent = { cue: { kind: 'ui', control: 'puzzle-try', item: null, index: null }, box: null, point: null, diff: [], el: null };

/** Every callback once, in a fixed order, with fixed arguments; answers what `item` named. */
function callEveryCallback(c: PuzzleHostCallbacks): ReturnType<PuzzleHostCallbacks['item']> {
  const named = c.item('medal' as ItemId);
  c.onchange([1, 2]);
  c.ontry();
  c.ongiveup();
  c.onhint();
  c.onretry();
  c.onusehint(2);
  c.ongetmore();
  c.oncue?.(TRY_CUE);
  return named;
}

/** What `callEveryCallback` records on a host tagged `tag`. */
const everyCallbackOn = (tag: string): unknown[][] => [
  [tag, 'item', 'medal'],
  [tag, 'onchange', [1, 2]],
  [tag, 'ontry'],
  [tag, 'ongiveup'],
  [tag, 'onhint'],
  [tag, 'onretry'],
  [tag, 'onusehint', 2],
  [tag, 'ongetmore'],
  [tag, 'oncue', 'ui:puzzle-try'],
];

test("puzzle-view: forwardHost reaches the current session's host and nothing after it ends", () => {
  const calls: unknown[][] = [];
  let current: PuzzleHostCallbacks | undefined = recordingHost('a', calls);
  const forward = forwardHost(() => current);
  // One forwarder per callback, no more: a lane adding a callback edits the forwarder and this list.
  expect(Object.keys(forward).sort()).toEqual(['item', 'onchange', 'oncue', 'ongetmore', 'ongiveup', 'onhint', 'onretry', 'ontry', 'onusehint']);
  expect(callEveryCallback(forward)).toEqual({ name: 'a medal', glyph: 'sun' });
  expect(calls).toEqual(everyCallbackOn('a'));
  // A later session: the same forwarders reach its host only (the getter runs at each call, never at creation).
  calls.length = 0;
  current = recordingHost('b', calls);
  expect(callEveryCallback(forward)).toEqual({ name: 'b medal', glyph: 'sun' });
  expect(calls).toEqual(everyCallbackOn('b'));
  // The session ended: every forwarder returns without a throw, reaches nothing, and `item` names no piece.
  calls.length = 0;
  current = undefined;
  let named: ReturnType<PuzzleHostCallbacks['item']> | undefined;
  expect(() => {
    named = callEveryCallback(forward);
  }).not.toThrow();
  expect(named).toBeNull();
  expect(calls).toEqual([]);
});

test('puzzle-view: coversStage is true for every frame today', () => {
  expect(coversStage(null)).toBe(false);
  // A linear or an exploration puzzle, its type chunk loading or failed, an ended one: each covers the stage.
  const frames = [frameOf(), frameOf({ mode: 'explore' }), frameOf({ ui: null }), frameOf({ ui: null, loadFailed: true }), frameOf({ line: 'solved' })];
  expect(frames.map((f) => coversStage(f))).toEqual([true, true, true, true, true]);
  // The store answers it for its frame at each read (App reads it there), following every write of the frame.
  const view = createPuzzleView();
  expect(view.covers).toBe(false);
  view.frame = frameOf();
  expect(view.covers).toBe(true);
  view.frame = null;
  expect(view.covers).toBe(false);
});

// ---------------------------------------------------------------------------------------------------------------
// GM3p: the frame is a cue family (engine plan §8.3): its root emits each declared control's cue

/** A `[data-cue]` control as `name@index` (`@index` only with `data-cue-index`). */
const controlKey = (el: HTMLElement): string => `${el.dataset.cue ?? ''}${el.dataset.cueIndex === undefined ? '' : `@${el.dataset.cueIndex}`}`;

/**
 * Renders the host with `props` and taps every enabled control it shows, each once: the first one not yet tapped in
 * document order (`'first'`) or from the end (`'last'`), re-reading the DOM after each tap (a tap may show new
 * controls: Give up's question shows No and Yes, and either one hides the other). A disabled control takes no tap, so
 * it plays nothing; a state where it is enabled taps it. Answers the controls tapped and the `ui` cues played, both as
 * `ui:name@index`, in tap order.
 */
function tapEveryControl(props: PuzzleHostProps, from: 'first' | 'last'): { tapped: string[]; played: string[] } {
  const played: string[] = [];
  const oncue = (e: CueEvent): void => {
    if (e.cue.kind === 'ui') {
      played.push(`ui:${e.cue.control}${e.cue.index === null ? '' : `@${e.cue.index}`}`);
    }
  };
  const { container, unmount } = render(PuzzleHost, { ...props, oncue });
  const tapped: string[] = [];
  for (;;) {
    const fresh = [...container.querySelectorAll<HTMLElement>('[data-cue]')].filter(
      (el) => !(el instanceof HTMLButtonElement && el.disabled) && !tapped.includes(`ui:${controlKey(el)}`),
    );
    const next = from === 'first' ? fresh[0] : fresh.at(-1);
    if (next === undefined) {
      break;
    }
    tapped.push(`ui:${controlKey(next)}`);
    tap(next);
  }
  unmount();
  return { tapped, played };
}

const ORDER_PIECES = ['medal_sun', 'medal_moon', 'medal_star'];

test('puzzles: every declared control emits its cue', () => {
  // The frame's states that show every control: a linear code frame with Give up and a ladder that can be used, an
  // exploration order frame whose ladder cannot be paid (get more), and a frame whose type chunk failed (Retry).
  const states: Array<[string, PuzzleHostProps]> = [
    ['code', hostProps({ ladder: ladderOf(TIERS, { cost: 1, balance: 2 }) })],
    [
      'order',
      hostProps({
        frame: frameOf({ mode: 'explore', type: 'order', params: { pieces: ORDER_PIECES }, answer: [0, 1, 2], ui: OrderPuzzle }),
        ladder: ladderOf(TIERS, { cost: 3, balance: 0 }),
        item: (id) => ({ name: id, glyph: 'sun' }),
      }),
    ],
    ['load failed', hostProps({ frame: frameOf({ ui: null, loadFailed: true }) })],
  ];
  const names = new Set<string>();
  for (const [name, props] of states) {
    for (const from of ['first', 'last'] as const) {
      const { tapped, played } = tapEveryControl(props, from);
      // One cue per tap, the tapped control's own, with its index.
      expect(played, `${name} (${from})`).toEqual(tapped);
      for (const key of tapped) {
        names.add(key.replace(/@.*$/, ''));
      }
    }
  }
  // Every control the frame family declares was shown and tapped (the controls gate holds each name to its type).
  expect([...names].sort()).toEqual(
    ['dial-down', 'dial-up', 'give-up-ask', 'give-up-no', 'give-up-yes', 'hint-more', 'hint-use', 'order-slot', 'puzzle-hint', 'puzzle-retry', 'puzzle-try'].map(
      (n) => `ui:${n}`,
    ),
  );
});

/**
 * The declarations of every rule of a component's <style> whose selector list holds exactly `selector` (a copy of
 * explore.svelte.test.ts's reader, narrowed to whole selectors so `.host-failed p` does not count as `.host-failed`).
 */
function declarationsOf(source: string, selector: string): Map<string, string> {
  const style = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1] ?? '').join('\n');
  const out = new Map<string, string>();
  for (const m of style.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!(m[1] ?? '').split(',').some((s) => s.trim() === selector)) {
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

test('puzzle-host: Retry is disabled only while it reloads', () => {
  // GM3w's two bindings, PuzzleHost's notice and App's failed-host block: `retrying`, never `busy` (00-decision-table W1).
  for (const [name, source] of [
    ['PuzzleHost', puzzleHostSource],
    ['App', appSource],
  ] as const) {
    const bindings = [...source.matchAll(/data-cue="puzzle-retry"[^\n]*/g)].map((m) => /\bdisabled=\{([^}]*)\}/.exec(m[0])?.[1] ?? null);
    expect(bindings, name).toEqual(['frame.retrying']);
  }
  // The frame's Retry: enabled over a failed load, during a values wait too (neither wait wins); disabled while it reloads.
  const cases: ReadonlyArray<readonly [string, Partial<PuzzleFrameView>, boolean]> = [
    ['a failed load', {}, false],
    ['a failed load during a values wait', { busy: true, line: 'checking' }, false],
    ['a reload', { retrying: true }, true],
  ];
  for (const [name, over, disabled] of cases) {
    const { getByRole, unmount } = render(PuzzleHost, hostProps({ frame: frameOf({ ui: null, loadFailed: true, ...over }) }));
    expect((getByRole('button', { name: t('en', 'puzzle.retry') }) as HTMLButtonElement).disabled, name).toBe(disabled);
    unmount();
  }
});

test('puzzle host: the frame layer takes taps only on the frame and the load notice', () => {
  // happy-dom computes no cascade: the rules are read from the sources. App's frame layer passes every tap through and
  // the two blocks it can hold take them back; both are full-bleed, so every tap they took they still take.
  expect(declarationsOf(appSource, '.frame-layer').get('pointer-events')).toBe('none');
  expect(declarationsOf(appSource, '.host-failed').get('pointer-events')).toBe('auto');
  expect(declarationsOf(puzzleHostSource, '.frame').get('pointer-events')).toBe('auto');
  // The rule has one element: the wrapper of the frame layer.
  expect([...appSource.matchAll(/class="layer frame-layer"/g)]).toHaveLength(1);
});

// ---------------------------------------------------------------------------------------------------------------
// The reader rules (spec 2, K26): copies of L14b's readers (menus.svelte.test.ts; RULINGS 55 accepts copies) over the
// four puzzle components, with an exact import list per component (critique W2): a value import beyond it, such as
// the Telegram facade, is an offender.

const COMPONENT_SOURCES = import.meta.glob<string>(['./*.svelte', '../../puzzles/ui/*.svelte'], { query: '?raw', import: 'default', eager: true });

/** Each component and the only modules it may import as values. */
const VALUE_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  './PuzzleHost.svelte': ['../../cues/root.ts', '../../i18n/index.ts', './HintLadder.svelte'],
  './HintLadder.svelte': ['../../i18n/index.ts'],
  '../../puzzles/ui/CodeLock.svelte': ['../../i18n/index.ts', '../rules/index.ts'],
  '../../puzzles/ui/OrderPuzzle.svelte': ['../../i18n/index.ts', '../../ui/glyphs.ts', '../rules/index.ts'],
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
