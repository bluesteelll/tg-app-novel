// @vitest-environment happy-dom
// The cue player (engine plan §8.5): every key animates, each target is found at its phase, a leaving element's
// motion continues on its ghost, fallbacks are counted, hit areas and end motions play by their rules, and the loops
// and holds end at their keys. A fixture DOM (happy-dom), a fake `animate` on vitest's fake clock.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { Box } from '../../geom/cover.ts';
import { KERNEL_FACT_KINDS } from '../../mechanics/contract.ts';
import type { CauseVerb, FactKind, MechanicId } from '../../mechanics/contract.ts';
import { MECHANIC_DATA } from '../../mechanics/data/index.ts';
import { MECHANIC_RULES } from '../../mechanics/rules/index.ts';
import type { PuzzleLocalId } from '../../story/staging.ts';
import type { ScreenKind } from '../../ui/screens.ts';
import type { ItemId, RoomId } from '../../world/types.ts';
import { CORE_CONTROLS, MOVE_HOWS, PUZZLE_CUES, UI_STATE_CUES } from '../types.ts';
import type { ControlCue, Cue, CueEvent, CueKey, MoveHow, PuzzleCue, UiStateCue } from '../types.ts';
import { CHECKING_ENDS, CUE_MOTIONS, declaredControls } from './motions.ts';
import type { CueTarget } from './motions.ts';
import { createCuePlayer, WAIT_DELAY_MS } from './player.ts';
import type { CuePlayer, Resolved } from './player.ts';

/** A fake `Animation` on the fake clock: finishes `ms` after its start; `currentTime` moves its start. */
class FakeAnimation {
  onfinish: (() => void) | null = null;
  playState: 'running' | 'finished' | 'idle' = 'running';
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

type Rec = {
  readonly el: Element;
  readonly kf: Keyframe[];
  readonly ms: number;
  readonly fill: 'none' | 'forwards';
  readonly at: number;
  readonly anim: FakeAnimation;
};

const STAGE: Box = { x: 0, y: 0, w: 400, h: 600 };
const CENTRE: Box = { x: 164, y: 264, w: 72, h: 72 };
const EDGE: Box = { x: 172, y: 572, w: 56, h: 56 };
const HOTSPOT: Box = { x: 40, y: 80, w: 60, h: 40 };

/** The DOM targets a fixture resolves by selector; every other target resolves to a box. */
const SELECTORS: { readonly [T in CueTarget]?: string } = {
  control: '[data-cue]',
  ribbon: '[data-cue-item]',
  inventory: '[data-cue="bar-inventory"]',
  frame: '[data-cue-frame]',
  panel: '[data-cue-panel]',
  status: '[data-cue-status]',
  attempts: '[data-cue-attempts]',
  part: '[data-cue-part]',
  tier: '[data-cue-tier]',
  ladder: '[data-cue-panel="hints"]',
  alert: '[data-cue-alert]',
  notice: '[data-cue-notice]',
};

type Fixture = {
  readonly player: CuePlayer;
  readonly records: Rec[];
  readonly ghosts: { readonly box: Box; readonly of: Element | null; readonly el: Element }[];
  readonly layer: Element;
  readonly haptics: string[];
};

/** A player over the document: `ribbon` / `inventory` with nothing live land at `edge`; `box` is the event's box,
 *  else its panel's element when it names one, else `centre`; `stage` the stage box; `point` and `edge` their boxes; any other DOM target with nothing live (ghosts
 *  on the stage layer skipped) is null. */
function fixture(opts: { readonly reduced?: boolean; readonly resolve?: (t: CueTarget, e: CueEvent) => Resolved } = {}): Fixture {
  const records: Rec[] = [];
  const ghosts: { box: Box; of: Element | null; el: Element }[] = [];
  const haptics: string[] = [];
  const layer = document.createElement('div');
  layer.className = 'stage-layer';
  document.body.append(layer);
  const resolveDefault = (t: CueTarget, e: CueEvent): Resolved => {
    switch (t) {
      case 'box': {
        // A box-less hold of a panel plays on the panel (§8.5 "Cue targets", `box` row).
        if (e.box === null && e.cue.kind === 'ui-state' && e.cue.panel !== null) {
          const panel = document.querySelector(`[data-cue-panel="${e.cue.panel}"]`);
          return panel === null ? null : { el: panel };
        }
        return { box: e.box ?? CENTRE };
      }
      case 'stage':
        return { box: STAGE };
      case 'point':
      case 'edge':
        return { box: EDGE };
      default: {
        // The stage layer's ghosts are clones: a resolver never returns one.
        const el = [...document.querySelectorAll(SELECTORS[t] ?? '[data-none]')].find((c) => c.closest('.stage-layer') === null);
        if (el !== undefined) {
          return { el };
        }
        return t === 'ribbon' || t === 'inventory' ? { box: EDGE } : null;
      }
    }
  };
  const player = createCuePlayer({
    animate(el, kf, ms, fill) {
      const anim = new FakeAnimation(ms);
      records.push({ el, kf, ms, fill, at: Date.now(), anim });
      // The fake stands for the DOM's Animation: the player reads `onfinish`, `currentTime` and `cancel` only.
      return anim as unknown as Animation;
    },
    resolve: opts.resolve ?? resolveDefault,
    boxOf: (el) => BOXES.get(el) ?? HOTSPOT,
    ghost(box, of) {
      const el = of === null ? document.createElement('div') : of.cloneNode(true);
      // A clone of an element is an Element; `cloneNode` is typed as a Node.
      const g = el as Element;
      g.classList.add('cue-ghost');
      layer.append(g);
      ghosts.push({ box, of, el: g });
      return g;
    },
    reduced: () => opts.reduced ?? false,
    haptic: (h) => haptics.push(h),
  });
  return { player, records, ghosts, layer, haptics };
}

const BOXES = new WeakMap<Element, Box>();

function element(tag: string, attrs: Readonly<Record<string, string>>, box: Box = HOTSPOT, parent: Element = document.body): Element {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  BOXES.set(el, box);
  parent.append(el);
  return el;
}

// Fixture ids: the brands are the world decoder's; a test names its own.
const P = 'drawer' as PuzzleLocalId;
const Q = 'gate' as PuzzleLocalId;

function cueOf(key: string, opts: { readonly puzzle?: PuzzleLocalId; readonly panel?: ScreenKind | null; readonly verb?: CauseVerb } = {}): Cue {
  const [kind = '', a = '', b = ''] = key.split(':');
  switch (kind) {
    case 'fact':
      // A fixture fact of the key's kind; the kind is one of the registries' (the key set is built from them).
      return { kind: 'fact', fact: { kind: a as FactKind, id: 'x' }, change: b === 'added' ? 'added' : 'removed', cause: { verb: opts.verb ?? 'tap', at: null, item: null, via: null } };
    case 'move':
      // The key set is built from MOVE_HOWS.
      return { kind: 'move', from: null, to: 'hall' as RoomId, via: null, how: a as MoveHow };
    case 'module':
      // A module key's id and name are the rules registry's.
      return { kind: 'module', module: a as MechanicId, name: b, at: null, item: null };
    case 'ui':
      // The key set is built from the control registries.
      return { kind: 'ui', control: a as ControlCue, item: null, index: null };
    case 'ui-state':
      // The key set is built from UI_STATE_CUES.
      return { kind: 'ui-state', name: a as UiStateCue, panel: opts.panel ?? null, item: 'key' as ItemId };
    default:
      // The key set is built from PUZZLE_CUES.
      return { kind: 'puzzle', puzzle: opts.puzzle ?? P, name: a as PuzzleCue, index: 0 };
  }
}

function eventOf(cue: Cue, el: Element | null = null, box: Box | null = HOTSPOT): CueEvent {
  return { cue, box, point: null, diff: [], el };
}

function emit(f: Fixture, e: CueEvent): void {
  f.player.run(f.player.capture(e));
}

/** Records still running (not finished, not cancelled). */
function running(f: Fixture): Rec[] {
  return f.records.filter((r) => r.anim.playState === 'running');
}

/** happy-dom delivers MutationObserver records on a real microtask, which the fake clock does not run. */
async function microtasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

function controlKeys(): string[] {
  return [...CORE_CONTROLS, ...declaredControls().map((d) => d.name)].map((c) => `ui:${c}`);
}

function nonControlKeys(): string[] {
  const facts = [...new Set<string>([...KERNEL_FACT_KINDS, ...MECHANIC_DATA.flatMap((m): readonly string[] => m.owns.facts ?? [])])];
  return [
    ...facts.flatMap((k) => [`fact:${k}:added`, `fact:${k}:removed`]),
    ...MOVE_HOWS.map((h) => `move:${h}`),
    ...MECHANIC_RULES.flatMap((r) => {
      const names: readonly string[] = r.cues;
      return names.map((c) => `module:${r.id}:${c}`);
    }),
    ...UI_STATE_CUES.map((n) => `ui-state:${n}`),
    ...PUZZLE_CUES.map((n) => `puzzle:${n}`),
  ];
}

/** A fixture DOM in which every DOM target is live. */
function fullDom(): void {
  element('button', { 'data-cue': 'bar-inventory' });
  const ribbon = element('div', { 'data-cue-ribbon': '' });
  element('div', { 'data-cue-item': 'key' }, HOTSPOT, ribbon);
  element('div', { 'data-cue-panel': 'inventory' });
  const frame = element('div', { 'data-cue-frame': '' });
  for (const attr of ['data-cue-status', 'data-cue-attempts', 'data-cue-part', 'data-cue-notice']) {
    element('p', { [attr]: '0' }, HOTSPOT, frame);
  }
  const ladder = element('div', { 'data-cue-panel': 'hints' }, HOTSPOT, frame);
  element('li', { 'data-cue-tier': '0' }, HOTSPOT, ladder);
  element('p', { 'data-cue-alert': '' }, HOTSPOT, ladder);
}

type Step = { readonly emit: CueKey } | { readonly advance: number };
/** The keys that need more than one event to play: each script's last event is its key. */
const KEY_SCRIPTS: { readonly [K in CueKey]?: readonly Step[] } = {
  'ui-state:waiting': [{ emit: 'ui-state:waiting' }, { advance: WAIT_DELAY_MS + 1 }],
  'ui-state:waited': [{ emit: 'ui-state:waiting' }, { advance: WAIT_DELAY_MS + 1 }, { emit: 'ui-state:waited' }],
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
});

test('cues: the player animates every key', () => {
  const keys = [...nonControlKeys(), ...controlKeys()];
  expect(keys.length).toBeGreaterThan(80);
  const silent: string[] = [];
  for (const key of keys) {
    document.body.replaceChildren();
    fullDom();
    const f = fixture();
    const control = key.startsWith('ui:') ? element('button', { 'data-cue': key.slice(3) }) : null;
    // The key set is built from the registries' runtime tuples, which `CueKey` derives from.
    const script: readonly Step[] = KEY_SCRIPTS[key as CueKey] ?? [{ emit: key as CueKey }];
    // A script can neither name a stale key nor hide another key: its last event is its key.
    const lastEmit = script.findLastIndex((s) => 'emit' in s);
    expect(script[lastEmit], key).toEqual({ emit: key });
    let before = 0;
    script.forEach((s, i) => {
      if ('advance' in s) {
        vi.advanceTimersByTime(s.advance);
        return;
      }
      if (i === lastEmit) {
        before = f.records.length;
      }
      emit(f, eventOf(cueOf(s.emit), control));
    });
    if (f.records.length - before < 1) {
      silent.push(key);
    }
    f.player.dispose();
  }
  expect(silent).toEqual([]);
});

test('player: an emit motion is caught at capture and a flush motion is found at run', () => {
  const f = fixture();
  // `panel-close` is `'emit'`: the sheet the write removes is caught before the flush.
  const sheet = element('div', { 'data-cue-panel': 'inventory' }, { x: 0, y: 300, w: 400, h: 300 });
  const closing = f.player.capture(eventOf(cueOf('ui-state:panel-close', { panel: 'inventory' }), null, null));
  sheet.remove();
  f.player.run(closing);
  // `panel-open` is `'flush'`: the sheet the write creates is found after the flush.
  const opening = f.player.capture(eventOf(cueOf('ui-state:panel-open', { panel: 'inventory' }), null, null));
  const opened = element('div', { 'data-cue-panel': 'inventory' }, { x: 0, y: 300, w: 400, h: 300 });
  f.player.run(opening);
  expect(f.player.fallbacks()).toBe(0);
  const [settle, lift] = f.records;
  // The closed sheet's slide-out runs on its ghost clone at the box caught at the emit, not at the stage centre.
  expect(settle?.el.classList.contains('cue-ghost')).toBe(true);
  expect(f.ghosts[0]?.of).toBe(sheet);
  expect(f.ghosts[0]?.box).toEqual({ x: 0, y: 300, w: 400, h: 300 });
  expect(lift?.el).toBe(opened);
  expect(f.ghosts.map((g) => g.box)).not.toContainEqual(CENTRE);
});

test('player: an emit motion whose element leaves continues on its ghost from the same time', async () => {
  const observers = new Set<MutationObserver>();
  const Base = MutationObserver;
  vi.stubGlobal(
    'MutationObserver',
    class extends Base {
      observe(target: Node, options?: MutationObserverInit): void {
        observers.add(this);
        super.observe(target, options);
      }
      disconnect(): void {
        observers.delete(this);
        super.disconnect();
      }
    },
  );
  try {
    const f = fixture();
    const button = element('button', { 'data-cue': 'give-up-yes' }, { x: 10, y: 20, w: 80, h: 30 });
    emit(f, eventOf(cueOf('ui:give-up-yes'), button, { x: 10, y: 20, w: 80, h: 30 }));
    expect(f.records[0]?.el).toBe(button);
    const watching = observers.size;
    vi.advanceTimersByTime(60);
    button.remove();
    await microtasks();
    const [first, moved] = f.records;
    expect(first?.anim.playState).toBe('idle');
    expect(moved?.el.classList.contains('cue-ghost')).toBe(true);
    expect(f.ghosts[0]?.of).toBe(button);
    expect(f.ghosts[0]?.box).toEqual({ x: 10, y: 20, w: 80, h: 30 });
    expect(moved?.anim.currentTime).toBe(60);
    // One observer, observing only while a watched motion runs.
    expect(watching).toBe(1);
    vi.advanceTimersByTime(200);
    expect(moved?.anim.playState).toBe('finished');
    expect(moved?.el.isConnected).toBe(false);
    expect(observers.size).toBe(0);
    expect(f.player.fallbacks()).toBe(0);
    // A stage that unmounts while a watched motion runs stops observing.
    const again = element('button', { 'data-cue': 'give-up-yes' }, { x: 10, y: 20, w: 80, h: 30 });
    emit(f, eventOf(cueOf('ui:give-up-yes'), again, { x: 10, y: 20, w: 80, h: 30 }));
    expect(observers.size).toBe(1);
    f.player.dispose();
    expect(running(f)).toEqual([]);
    expect(observers.size).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('player: a first motion with no target counts one fallback', () => {
  // A first motion with no target plays at the stage centre and counts.
  const lost = fixture();
  emit(lost, eventOf(cueOf('puzzle:wrong')));
  expect(lost.player.fallbacks()).toBe(1);
  expect(lost.ghosts.map((g) => g.box)).toEqual([CENTRE]);
  // A `with` that does not resolve is skipped and not counted.
  element('div', { 'data-cue-frame': '' });
  const skipped = fixture();
  emit(skipped, eventOf(cueOf('puzzle:ready')));
  expect(skipped.player.fallbacks()).toBe(0);
  expect(skipped.records).toHaveLength(1);
  // The `edge` landing is no fallback: the fly plays there and the slot's pulse is skipped.
  const edge = fixture();
  emit(edge, eventOf(cueOf('fact:held:added')));
  expect(edge.player.fallbacks()).toBe(0);
  expect(edge.records).toHaveLength(1);
  expect(edge.ghosts.map((g) => g.box)).toEqual([EDGE]);
  // A cue whose only motion is element-site on a ribbon target at `edge` plays nothing: counted once.
  const nothing = fixture();
  emit(nothing, eventOf(cueOf('ui-state:select')));
  expect(nothing.records).toHaveLength(0);
  expect(nothing.player.fallbacks()).toBe(1);
});

test('player: an element motion on a hit area plays on its painted ghost', () => {
  const f = fixture();
  const hotspot = element('button', { 'data-cue': 'hotspot', 'data-cue-hit': '' });
  emit(f, eventOf(cueOf('ui:hotspot'), hotspot));
  const inner = element('span', {}, HOTSPOT, hotspot);
  emit(f, eventOf(cueOf('ui:hotspot'), inner));
  expect(f.records).toHaveLength(2);
  for (const r of f.records) {
    expect(r.el).not.toBe(hotspot);
    expect(r.el).not.toBe(inner);
    expect(r.el.classList.contains('cue-ghost')).toBe(true);
    expect(r.el.classList.contains('cue-hit')).toBe(true);
    expect(r.el.isConnected).toBe(true);
  }
  vi.advanceTimersByTime(1000);
  expect(f.records.every((r) => !r.el.isConnected)).toBe(true);
  expect(f.layer.children).toHaveLength(0);
});

test('player: an end motion holds its last frame, and moves to a ghost only if its element leaves mid-motion', async () => {
  const f = fixture();
  const done = element('div', { 'data-cue-frame': '' });
  emit(f, eventOf(cueOf('puzzle:failed')));
  expect(f.records[0]?.el).toBe(done);
  expect(f.records[0]?.fill).toBe('forwards');
  vi.advanceTimersByTime(500);
  done.remove();
  await microtasks();
  // Removed after the motion's end: no ghost.
  expect(f.records).toHaveLength(1);
  expect(f.ghosts).toHaveLength(0);
  const leaving = element('div', { 'data-cue-frame': '' });
  emit(f, eventOf(cueOf('puzzle:solved')));
  vi.advanceTimersByTime(200);
  leaving.remove();
  await microtasks();
  const moved = f.records[2];
  expect(f.ghosts.map((g) => g.of)).toEqual([leaving]);
  expect(moved?.el.classList.contains('cue-ghost')).toBe(true);
  expect(moved?.fill).toBe('forwards');
  expect(moved?.anim.currentTime).toBe(200);
  expect(f.player.fallbacks()).toBe(0);
});

test('cues: puzzle checking breathes until its frame settles', () => {
  for (const key of CHECKING_ENDS) {
    document.body.replaceChildren();
    const wrapper = element('div', { 'data-cue-frame': '' });
    const f = fixture();
    emit(f, eventOf(cueOf('puzzle:checking')));
    vi.advanceTimersByTime(5000);
    // One breath at a time, restarted at each end: still running after 5 s.
    const breaths = running(f).filter((r) => r.el === wrapper);
    expect(breaths, key).toHaveLength(1);
    expect(f.records.length, key).toBeGreaterThan(1);
    // Neither another puzzle's settling key nor a non-settling key of this one ends it.
    emit(f, eventOf(cueOf('puzzle:wrong', { puzzle: Q })));
    emit(f, eventOf(cueOf('puzzle:input')));
    const [breath] = breaths;
    expect(breath?.anim.playState, key).toBe('running');
    // The key's run cancels the loop where it stands and starts the key's own motion in the same step.
    const now = Date.now();
    const count = f.records.length;
    emit(f, eventOf(cueOf(key)));
    expect(f.records.length, key).toBeGreaterThan(count);
    expect(f.records.slice(count).map((r) => r.at), key).toEqual(f.records.slice(count).map(() => now));
    expect(breath?.anim.playState, key).toBe('idle');
    vi.advanceTimersByTime(5000);
    expect(running(f), key).toEqual([]);
    f.player.dispose();
  }
  // With no frame on screen the loop breathes on a centre ghost, which a stage that unmounts removes with the loop.
  document.body.replaceChildren();
  const lost = fixture();
  emit(lost, eventOf(cueOf('puzzle:checking')));
  vi.advanceTimersByTime(5000);
  expect(running(lost)).toHaveLength(1);
  expect(lost.layer.children).toHaveLength(1);
  lost.player.dispose();
  expect(running(lost)).toEqual([]);
  expect(lost.layer.children).toHaveLength(0);
  // The loop's ends are the state gate's settling keys and the frame's close.
  expect(CUE_MOTIONS['puzzle:checking'].until).toEqual([
    'puzzle:wrong',
    'puzzle:failed',
    'puzzle:solved',
    'puzzle:offline',
    'puzzle:rate-limited',
    'puzzle:ready',
    'puzzle:renewed',
    'puzzle:reset',
    'puzzle:closed',
  ]);
});

test('cues: a waiting hold shows only past its delay and ends at waited', () => {
  const f = fixture();
  // A wait shorter than the delay shows nothing.
  emit(f, eventOf(cueOf('ui-state:waiting')));
  vi.advanceTimersByTime(WAIT_DELAY_MS - 20);
  emit(f, eventOf(cueOf('ui-state:waited')));
  vi.advanceTimersByTime(2000);
  expect(f.records).toEqual([]);
  // Past it the hold loops until its waited, which settles where the hold played.
  emit(f, eventOf(cueOf('ui-state:waiting')));
  vi.advanceTimersByTime(WAIT_DELAY_MS + 1);
  expect(running(f)).toHaveLength(1);
  vi.advanceTimersByTime(3000);
  expect(running(f)).toHaveLength(1);
  const breaths = f.records.length;
  expect(breaths).toBeGreaterThan(1);
  emit(f, eventOf(cueOf('ui-state:waited')));
  expect(f.records).toHaveLength(breaths + 1);
  expect(f.records.at(-1)?.ms).toBe(CUE_MOTIONS['ui-state:waited'].ms);
  vi.advanceTimersByTime(3000);
  expect(running(f)).toEqual([]);
  expect(f.layer.children).toHaveLength(0);
  // A stage that unmounts ends a shown hold (its ghost removed) and a pending one (its timer cleared: no ghost later).
  emit(f, eventOf(cueOf('ui-state:waiting')));
  vi.advanceTimersByTime(WAIT_DELAY_MS + 1);
  expect(f.layer.children).toHaveLength(1);
  f.player.dispose();
  expect(running(f)).toEqual([]);
  expect(f.layer.children).toHaveLength(0);
  const g = fixture();
  emit(g, eventOf(cueOf('ui-state:waiting')));
  g.player.dispose();
  vi.advanceTimersByTime(3000);
  expect(g.records).toEqual([]);
  expect(g.ghosts).toEqual([]);
  expect(g.layer.children).toHaveLength(0);
  expect(f.player.fallbacks() + g.player.fallbacks()).toBe(0);
});

test('cues: a with motion whose target is missing is skipped and the first motion plays', () => {
  const wrapper = element('div', { 'data-cue-frame': '' });
  const f = fixture();
  // `renewed` breathes the frame with a `roll` on the attempts line, which this frame does not show.
  emit(f, eventOf(cueOf('puzzle:renewed')));
  expect(f.records.map((r) => r.el)).toEqual([wrapper]);
  expect(f.ghosts).toEqual([]);
  expect(f.player.fallbacks()).toBe(0);
});

test('cues: two waiting holds end at their own waited', () => {
  const f = fixture();
  const ladder = element('div', { 'data-cue-panel': 'hints' }, { x: 0, y: 400, w: 400, h: 200 });
  const room = (name: string): CueEvent => eventOf(cueOf(name, { panel: null }), null, HOTSPOT);
  const hints = (name: string): CueEvent => eventOf(cueOf(name, { panel: 'hints' }), null, null);
  emit(f, room('ui-state:waiting'));
  vi.advanceTimersByTime(WAIT_DELAY_MS + 1);
  const [roomRing] = f.ghosts;
  expect(roomRing?.box).toEqual(HOTSPOT);
  emit(f, hints('ui-state:waiting'));
  vi.advanceTimersByTime(WAIT_DELAY_MS + 1);
  const breathing = (): Element[] => running(f).map((r) => r.el);
  expect(breathing()).toEqual([roomRing?.el, ladder]);
  // The ladder's waited ends the ladder's hold only.
  emit(f, hints('ui-state:waited'));
  expect(breathing()).toContain(roomRing?.el);
  expect(running(f).filter((r) => r.el === ladder && r.ms === CUE_MOTIONS['ui-state:waiting'].ms)).toEqual([]);
  // A ladder cleared while its request is out: its waited is caught before the clear's flush and ends its hold.
  emit(f, hints('ui-state:waiting'));
  vi.advanceTimersByTime(WAIT_DELAY_MS + 1);
  const clearing = f.player.capture(hints('ui-state:waited'));
  ladder.remove();
  f.player.run(clearing);
  vi.advanceTimersByTime(CUE_MOTIONS['ui-state:waited'].ms + 1);
  expect(breathing()).toEqual([roomRing?.el]);
  // The room's waited ends the room's.
  emit(f, room('ui-state:waited'));
  vi.advanceTimersByTime(3000);
  expect(running(f)).toEqual([]);
  expect(f.layer.children).toHaveLength(0);
  expect(f.player.fallbacks()).toBe(0);
});
