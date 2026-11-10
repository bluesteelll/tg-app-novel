// The cue stage (engine plan §8.1, §8.3, §8.5; GM3s): the family root's emission, the stage's resolver, landings and
// ghosts, the real CueStage on a real Svelte flush, and the family roots' entrance and exit (RULINGS 195's fallback: no
// Svelte transition directive; the roots enter and leave as cue-stage motions). A fixture DOM in happy-dom, a recording
// `Element.prototype.animate` that returns a fake `Animation` on vitest's fake clock.
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { parse } from 'svelte/compiler';
import type { AST } from 'svelte/compiler';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { Box } from '../../geom/cover.ts';
import type { MechanicId } from '../../mechanics/contract.ts';
import type { PuzzleLocalId } from '../../story/staging.ts';
import { createExploreView } from '../../ui/explore-view.svelte.ts';
import type { ExploreLayerProps } from '../../ui/explore-view.svelte.ts';
import ExploreView from '../../ui/explore/ExploreView.svelte';
import appSource from '../../ui/App.svelte?raw';
import { createPuzzleView } from '../../ui/puzzle-view.svelte.ts';
import type { ScreenKind } from '../../ui/screens.ts';
import type { CueStageProps } from '../../ui/state.svelte.ts';
import type { ItemId } from '../../world/types.ts';
import { createCueBus } from '../bus.ts';
import type { CueBus } from '../bus.ts';
import { cueRoot, ROOT_TRIGGERS } from '../root.ts';
import { CUE_TRIGGERS } from '../types.ts';
import type { Cue, CueEvent } from '../types.ts';
import { LAYER_MOTIONS } from '../visible.ts';
import stageSource from './CueStage.svelte?raw';
import { CueStage, ghostOf, landing, resolveTarget } from './index.ts';
import type { CueTarget } from './motions.ts';
import { WAIT_DELAY_MS } from './player.ts';
import type { Resolved } from './player.ts';
import { PRESETS } from './presets.ts';

/** A fake `Animation` on the fake clock: finishes `ms` after its start; `currentTime` moves its start. Like happy-dom's
 *  own (critique O3), `updateTiming` records the timing and does not re-time the finish. */
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
const CENTRE: Box = { x: 164, y: 264, w: 72, h: 72 };
const EDGE: Box = { x: 172, y: 572, w: 56, h: 56 };
const HOTSPOT: Box = { x: 40, y: 80, w: 60, h: 40 };
const ROOT: Box = { x: 10, y: 20, w: 380, h: 560 };

/** Each fixture element's box (happy-dom lays nothing out); a `[data-cue-stage]` layer has the stage's box. */
const BOXES = new WeakMap<Element, Box>();
const realAnimate = Element.prototype.animate;
const realRect = Element.prototype.getBoundingClientRect;
let records: Rec[] = [];

function rectOf(b: Box): DOMRect {
  // The fields a DOMRect reader takes.
  return { x: b.x, y: b.y, left: b.x, top: b.y, width: b.w, height: b.h, right: b.x + b.w, bottom: b.y + b.h, toJSON: () => b } as DOMRect;
}

beforeEach(() => {
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
    const b = this.matches('[data-cue-stage]') ? STAGE : BOXES.get(this);
    return b === undefined ? realRect.call(this) : rectOf(b);
  };
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  Element.prototype.animate = realAnimate;
  Element.prototype.getBoundingClientRect = realRect;
  vi.useRealTimers();
});

/** An element with attributes and a box, appended to `parent`. */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string>> = {},
  box: Box = HOTSPOT,
  parent: Element = document.body,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  BOXES.set(el, box);
  parent.append(el);
  return el;
}

/** Lets the emitting block's flush, the stage's `tick` continuation and the observers' microtasks run. */
async function settle(): Promise<void> {
  await tick();
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

const event = (cue: Cue, box: Box | null = null, el: Element | null = null): CueEvent => ({ cue, box, point: null, diff: [], el });
type StateName = 'waiting' | 'waited' | 'panel-open' | 'panel-close' | 'select';
const uiState = (name: StateName, panel: ScreenKind | null): Cue => ({ kind: 'ui-state', name, panel, item: null });
/** A fact a tap adds (a take: `fact:held:added`; a document: `fact:doc:added`; a story note: `fact:story:added`; a
 *  device fired: `fact:fired:added`). */
const added = (kind: 'held' | 'doc' | 'story' | 'fired', id: string): Cue => ({
  kind: 'fact',
  fact: { kind, id },
  change: 'added',
  cause: { verb: 'tap', at: null, item: null, via: null },
});
const held = (): Cue => added('held', 'key');
const P = 'drawer' as PuzzleLocalId;

type Mounted = {
  readonly bus: CueBus;
  readonly layer: HTMLElement;
  readonly haptics: string[];
  readonly orphans: () => number;
  readonly unmount: () => void;
  /** The stage's debug attributes (D13; `__TG_MOCK__` is true under vitest). */
  readonly played: () => string[];
  readonly fallbacks: () => number;
};

/** The real CueStage on a bus, as App mounts it from the session's slot. */
function mounted(opts: { readonly reduced?: boolean; readonly bus?: CueBus } = {}): Mounted {
  const bus = opts.bus ?? createCueBus();
  const haptics: string[] = [];
  let dropped = 0;
  const props: CueStageProps = {
    subscribe: bus.subscribe,
    orphans: () => bus.orphans() + dropped,
    dropped: () => {
      dropped += 1;
    },
    reduced: opts.reduced ?? false,
    host: () => null,
    haptic: {
      impact: (s) => haptics.push(`impact:${s}`),
      selection: () => haptics.push('selection'),
      notify: (t) => haptics.push(`notify:${t}`),
    },
  };
  const { container, unmount } = render(CueStage, { props });
  const layer = container.querySelector<HTMLElement>('[data-cue-stage]');
  if (layer === null) {
    throw new Error('no stage layer');
  }
  return {
    bus,
    layer,
    haptics,
    orphans: props.orphans,
    unmount,
    played: () => (layer.dataset.cuesPlayed ?? '').split(' ').filter((k) => k !== ''),
    fallbacks: () => Number(layer.dataset.cueFallbacks),
  };
}

/** The cue motions recorded (the roots' entrances and exits left out). */
const cueMotions = (): Rec[] => records.filter((r) => !r.el.matches('[data-cue-root]') && !r.el.classList.contains('cue-root-ghost'));
/** A ghost's box, from the style the stage placed it with. */
function boxOfGhost(el: Element): Box {
  const s = el instanceof HTMLElement ? el.style : null;
  return { x: parseFloat(s?.left ?? ''), y: parseFloat(s?.top ?? ''), w: parseFloat(s?.width ?? ''), h: parseFloat(s?.height ?? '') };
}
/** What a target resolved to: the element itself (compared by identity), its box, or null; never a family root
 *  (RULINGS 135 (b)). */
function found(r: Resolved): Element | Box | null {
  if (r === null) {
    return null;
  }
  if ('box' in r) {
    return r.box;
  }
  expect(r.el.matches('[data-cue-root]')).toBe(false);
  return r.el;
}

// ---------------------------------------------------------------------------------------------------------------
// The family root (§8.3)

/** A `[data-cue-root]` element; the action is applied by the test. */
function root(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-cue-root', '');
  return el;
}

/** A control: `data-cue` with its declared trigger (`click` when omitted). */
function control(name: string, on?: string, index?: number): HTMLButtonElement {
  const el = document.createElement('button');
  el.dataset.cue = name;
  if (on !== undefined) {
    el.dataset.cueOn = on;
  }
  if (index !== undefined) {
    el.dataset.cueIndex = String(index);
  }
  return el;
}

test('cues: a control inside two nested roots emits once', () => {
  // A device host inside the room: each control emits once, from its innermost root.
  const outer = root();
  const inner = root();
  const own = control('bar-inventory');
  const hotspot = control('hotspot');
  const dial = control('dial-up', 'pointerdown', 2);
  inner.append(hotspot, dial);
  outer.append(own, inner);
  document.body.append(outer);
  const outerCues: CueEvent[] = [];
  const innerCues: CueEvent[] = [];
  const a = cueRoot(outer, (e) => outerCues.push(e));
  const b = cueRoot(inner, (e) => innerCues.push(e));
  hotspot.click();
  expect(innerCues.map((e) => [e.cue, e.el, e.box])).toEqual([[{ kind: 'ui', control: 'hotspot', item: null, index: null }, hotspot, null]]);
  expect(outerCues).toEqual([]);
  own.click();
  expect(outerCues.map((e) => e.cue)).toEqual([{ kind: 'ui', control: 'bar-inventory', item: null, index: null }]);
  // A control emits on its declared trigger only, with its index.
  dial.click();
  expect(innerCues).toHaveLength(1);
  dial.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(innerCues.map((e) => e.cue)).toEqual([
    { kind: 'ui', control: 'hotspot', item: null, index: null },
    { kind: 'ui', control: 'dial-up', item: null, index: 2 },
  ]);
  // The root carries its birth (the stage plays a root's entrance from it, RULINGS 195's fallback).
  expect(Number.isFinite(Number(inner.dataset.cueBorn))).toBe(true);
  expect(inner.dataset.cueBorn).not.toBe('');
  // A new emit reaches the next cues; none is a root with no emit.
  const later: CueEvent[] = [];
  b.update((e) => later.push(e));
  hotspot.click();
  b.update(undefined);
  hotspot.click();
  expect(later).toHaveLength(1);
  // §10: after destroy, no trigger emits.
  b.update((e) => later.push(e));
  a.destroy();
  b.destroy();
  hotspot.click();
  own.click();
  dial.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect([outerCues.length, innerCues.length, later.length]).toEqual([1, 2, 1]);
  outer.remove();
});

test("cues: the root's triggers are CUE_TRIGGERS", () => {
  // RULINGS 201 E2: the root keeps its own copy, so its chunk and the stage's share no `cues/types.ts` value (and no
  // chunk); a type equality ties the two in `check`, and this pin at run time, order included.
  expect([...ROOT_TRIGGERS]).toEqual([...CUE_TRIGGERS]);
});

// ---------------------------------------------------------------------------------------------------------------
// No Svelte transition directive (RULINGS 195, Q2's fallback: P0 measured the runtime in the entry past +0.55 KB br)

const SVELTE_SOURCES = import.meta.glob<string>('../../**/*.svelte', { query: '?raw', import: 'default', eager: true });

/** A Svelte transition directive on an element (`in:`, `out:`, `transition:`), outside comments, scripts and styles. */
function directivesOf(source: string): string[] {
  const markup = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  return [...markup.matchAll(/\s((?:in|out|transition):[A-Za-z_$][\w$]*)/g)].map((m) => m[1] ?? '');
}

test('cues: no Svelte transition directive in client/src', () => {
  // Non-vacuous: every component is read, and the reader finds a directive where one is.
  const files = Object.keys(SVELTE_SOURCES);
  expect(files).toContain('../../ui/explore/ExploreView.svelte');
  expect(files).toContain('../../ui/App.svelte');
  expect(files.length).toBeGreaterThan(20);
  expect(directivesOf('<div class="layer" in:layerIn|global={{ reduced }} out:fade>')).toEqual(['in:layerIn', 'out:fade']);
  expect(directivesOf('<p>sign in: now</p><!-- out:fade --><script>const o = { in:x };</script>')).toEqual([]);
  const found = Object.entries(SVELTE_SOURCES).flatMap(([file, source]) => directivesOf(source).map((d) => `${file}: ${d}`));
  expect(found).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// The stage on a real flush (§8.1 "When a cue's DOM target is found")

test('cues: a control removed in the same frame plays on a ghost', async () => {
  const s = mounted();
  // (i) The tap's block removes the control: the press caught at the emit plays on its ghost at the control's box.
  const button = element('button', { 'data-cue': 'hotspot' });
  s.bus.emit(event({ kind: 'ui', control: 'hotspot', item: null, index: null }, null, button));
  button.remove();
  await settle();
  const [press] = cueMotions();
  expect(press?.kf).toEqual(PRESETS.press);
  expect(press?.el).not.toBe(button);
  expect(press?.el.classList.contains('cue-ghost')).toBe(true);
  expect(press?.el.isConnected).toBe(true);
  expect(press === undefined ? null : boxOfGhost(press.el)).toEqual(HOTSPOT);
  // (ii) The control leaves a microtask after its motion started (M-R9h): the motion moves to a ghost from its time.
  const later = element('button', { 'data-cue': 'hotspot' });
  s.bus.emit(event({ kind: 'ui', control: 'hotspot', item: null, index: null }, null, later));
  await settle();
  const live = cueMotions().at(-1);
  expect(live?.el).toBe(later);
  vi.advanceTimersByTime(60);
  later.remove();
  await settle();
  const moved = cueMotions().at(-1);
  expect(moved?.el.classList.contains('cue-ghost')).toBe(true);
  expect(moved?.anim.currentTime).toBe(60);
  expect(live?.anim.playState).toBe('idle');
  // Every ghost leaves at its motion's finish.
  vi.advanceTimersByTime(180);
  expect(s.layer.querySelectorAll('.cue-ghost')).toHaveLength(0);
  expect(s.fallbacks()).toBe(0);
  expect(s.played()).toEqual(['ui:hotspot', 'ui:hotspot']);
});

test('stage: an unmounted stage plays nothing and counts orphans', async () => {
  const s = mounted();
  // A motion running at unmount ends with it.
  s.bus.emit(event({ kind: 'move', from: null, to: null, via: null, how: 'leave' }));
  await settle();
  expect(cueMotions()).toHaveLength(1);
  // A plan captured but not yet run at unmount: nothing plays, and it is counted.
  s.bus.emit(event(held()));
  expect(s.orphans()).toBe(0);
  s.unmount();
  await settle();
  expect(cueMotions()).toHaveLength(1);
  expect(s.orphans()).toBe(1);
  expect(records.every((r) => r.anim.playState !== 'running')).toBe(true);
  expect(document.querySelectorAll('.cue-ghost')).toHaveLength(0);
  // Later cues are held by the bus (no overlay subscriber) and play nowhere.
  s.bus.emit(event(held()));
  await settle();
  vi.advanceTimersByTime(1000);
  expect(cueMotions()).toHaveLength(1);
});

test('stage: the held entry cues of the first section play after the stage mounts', async () => {
  // A section's first entry emits before the stage's chunk is in: the bus holds them and replays them in order.
  const bus = createCueBus();
  bus.emit(event(uiState('waiting', null)));
  bus.emit(event(uiState('waited', null)));
  bus.emit(event({ kind: 'move', from: null, to: null, via: null, how: 'enter' }));
  expect(bus.orphans()).toBe(0);
  const s = mounted({ bus });
  await settle();
  expect(s.played()).toEqual(['ui-state:waiting', 'ui-state:waited', 'move:enter']);
  // The hold ended before its delay (no breathe); the entry's vignette plays on the stage.
  vi.advanceTimersByTime(WAIT_DELAY_MS);
  expect(cueMotions().map((r) => [r.kf, r.ms])).toEqual([[PRESETS.vignette, 600]]);
  expect(boxOfGhost(cueMotions()[0]?.el ?? s.layer)).toEqual(STAGE);
  expect([s.orphans(), s.fallbacks()]).toEqual([0, 0]);
});

// ---------------------------------------------------------------------------------------------------------------
// The resolver (§8.5 "Cue targets")

/** A frame, a ladder, a sheet, a ribbon, the bar's Inventory and App's Retry, inside a family root; the stage layer's
 *  clones that kept their markers come first in document order. */
function targets(): Record<string, Element> {
  const stale = element('div', { 'data-cue-stage': '' }, STAGE);
  for (const attr of ['data-cue-frame', 'data-cue-ribbon', 'data-cue-status', 'data-cue-notice', 'data-cue-alert']) {
    element('div', { [attr]: '' }, HOTSPOT, stale);
  }
  element('div', { 'data-cue-panel': 'hints' }, HOTSPOT, stale);
  element('button', { 'data-cue': 'bar-inventory' }, HOTSPOT, stale);
  const family = element('div', { 'data-cue-root': '' }, ROOT);
  const frame = element('div', { 'data-cue-frame': '', 'data-cue-panel': 'puzzle' }, ROOT, family);
  const ladder = element('div', { 'data-cue-panel': 'hints' }, ROOT, family);
  const ribbon = element('div', { 'data-cue-ribbon': '' }, ROOT, family);
  return {
    frame,
    ladder,
    status: element('p', { 'data-cue-status': '' }, HOTSPOT, frame),
    attempts: element('p', { 'data-cue-attempts': '' }, HOTSPOT, frame),
    part0: element('span', { 'data-cue-part': '0' }, HOTSPOT, frame),
    part2: element('span', { 'data-cue-part': '2' }, HOTSPOT, frame),
    tier0: element('li', { 'data-cue-tier': '0' }, HOTSPOT, ladder),
    tier1: element('li', { 'data-cue-tier': '1' }, HOTSPOT, ladder),
    alert: element('p', { 'data-cue-alert': '' }, HOTSPOT, ladder),
    sheet: element('div', { 'data-cue-panel': 'inventory' }, ROOT, family),
    slot: element('button', { 'data-cue-item': 'key' }, HOTSPOT, ribbon),
    other: element('button', { 'data-cue-item': 'coin' }, HOTSPOT, ribbon),
    bar: element('button', { 'data-cue': 'bar-inventory' }, HOTSPOT, family),
    retry: element('button', { 'data-cue': 'puzzle-retry' }),
    notice: element('div', { 'data-cue-notice': '' }, HOTSPOT, frame),
  };
}

test('stage: each target resolves by its attribute', () => {
  const t = targets();
  const layer = element('div', { 'data-cue-stage': '' }, STAGE);
  const at = (target: CueTarget, cue: Cue, box: Box | null = null): Element | Box | null => found(resolveTarget(target, event(cue, box), layer));
  const puzzle = (index: number | null): Cue => ({ kind: 'puzzle', puzzle: P, name: 'input', index });
  // `control` with no element: by its name (App's Retry, outside every cue root).
  expect(at('control', { kind: 'ui', control: 'puzzle-retry', item: null, index: null })).toBe(t.retry);
  expect(at('control', held())).toBeNull();
  // `box`: the event's; a box-less `hints` hold: the ladder (no notice in it).
  expect(at('box', held(), HOTSPOT)).toEqual(HOTSPOT);
  expect(at('box', uiState('waiting', 'hints'))).toBe(t.ladder);
  expect(at('box', held())).toBeNull();
  expect(at('point', held())).toBeNull();
  expect(found(resolveTarget('point', { ...event(held()), point: { x: 100, y: 200 } }, layer))).toEqual({ x: 64, y: 164, w: 72, h: 72 });
  expect(at('stage', held())).toEqual(STAGE);
  expect(at('edge', held())).toEqual(EDGE);
  // `ribbon`: the cue's item inside the live ribbon; `inventory`: the bar's control.
  expect(at('ribbon', held())).toBe(t.slot);
  expect(at('ribbon', { kind: 'ui-state', name: 'select', panel: null, item: 'coin' as ItemId })).toBe(t.other);
  expect(at('inventory', held())).toBe(t.bar);
  expect(at('frame', held())).toBe(t.frame);
  expect(at('panel', uiState('panel-open', 'inventory'))).toBe(t.sheet);
  expect(at('panel', held())).toBeNull();
  expect(at('status', held())).toBe(t.status);
  expect(at('attempts', held())).toBe(t.attempts);
  expect(at('part', puzzle(2))).toBe(t.part2);
  expect(at('part', puzzle(null))).toBe(t.frame);
  expect(at('tier', puzzle(1))).toBe(t.tier1);
  expect(at('tier', puzzle(null))).toBe(t.ladder);
  expect(at('ladder', held())).toBe(t.ladder);
  expect(at('alert', held())).toBe(t.alert);
  expect(at('notice', held())).toBe(t.notice);
  // The fallbacks the table names: a frame marker missing -> the frame; a ladder's -> the ladder; `attempts` -> none.
  t.status?.remove();
  t.attempts?.remove();
  t.part2?.remove();
  t.alert?.remove();
  t.tier1?.remove();
  t.notice?.remove();
  for (const r of [at('status', held()), at('part', puzzle(2)), at('notice', held())]) {
    expect(r).toBe(t.frame);
  }
  for (const r of [at('alert', held()), at('tier', puzzle(1))]) {
    expect(r).toBe(t.ladder);
  }
  expect(at('attempts', held())).toBeNull();
  // A live ribbon without the slot: nothing (the stage, counted).
  t.slot?.remove();
  expect(at('ribbon', held())).toBeNull();
});

test("stage: no target resolves inside a root's ghost", async () => {
  // A fixture stage layer first in document order holds a clone that kept its marker: the live target after it wins.
  const stale = element('div', { 'data-cue-stage': '' }, STAGE);
  const kept = element('div', { 'data-cue-frame': '' }, HOTSPOT, stale);
  const liveFrame = element('div', { 'data-cue-frame': '' }, ROOT);
  const layer = element('div', { 'data-cue-stage': '' }, STAGE);
  expect(found(resolveTarget('frame', event(held()), layer))).toBe(liveFrame);
  expect(found(resolveTarget('frame', event(held()), layer))).not.toBe(kept);
  liveFrame.remove();
  expect(resolveTarget('frame', event(held()), layer)).toBeNull();
  // A real root ghost made by the stage carries no id and no `data-cue*` attribute anywhere in its subtree.
  const s = mounted();
  const family = element('div', { 'data-cue-root': 'frame', id: 'frame-root' }, ROOT);
  const wrapper = element('div', { 'data-cue-frame': '', 'data-cue-panel': 'puzzle', id: 'w' }, ROOT, family);
  element('button', { 'data-cue': 'puzzle-try', 'data-cue-on': 'click', id: 'try' }, HOTSPOT, wrapper);
  element('p', { 'data-cue-status': '' }, HOTSPOT, wrapper);
  await settle();
  family.remove();
  await settle();
  const ghost = s.layer.querySelector('.cue-root-ghost');
  expect(ghost).not.toBeNull();
  const nodes = ghost === null ? [] : [ghost, ...ghost.querySelectorAll('*')];
  expect(nodes).toHaveLength(4);
  expect(nodes.flatMap((n) => [...n.attributes].map((a) => a.name)).filter((n) => n === 'id' || n.startsWith('data-cue'))).toEqual([]);
  // Nothing in it resolves: the frame is gone with its root.
  expect(resolveTarget('frame', event(held()), s.layer)).toBeNull();
  // ghostOf strips a plain clone the same way.
  const g = ghostOf(HOTSPOT, element('button', { 'data-cue': 'hotspot', 'data-cue-hit': '', id: 'h' }), s.layer);
  expect([g.id, g.getAttribute('data-cue'), g.hasAttribute('data-cue-hit'), g.hasAttribute('inert'), g.style.pointerEvents]).toEqual(['', null, false, true, 'none']);
});

// ---------------------------------------------------------------------------------------------------------------
// The ghost style (RULINGS 203: every ghost a cue row reaches paints something its preset's keyframes make visible)

/** The properties that paint a box with no content of its own. */
const PAINT_PROPS = ['background', 'background-image', 'background-color', 'box-shadow', 'outline', 'border'];

/** Every colour's alpha in a CSS value (`rgb()` / `rgba()` and hex); `none` and `transparent` name none. */
function alphasOf(value: string): number[] {
  return [...value.toLowerCase().matchAll(/rgba?\(([^)]*)\)|#([0-9a-f]{3,8})\b/g)].map(([, fn, hex = '']) => {
    if (fn !== undefined) {
      const a = fn.split(/[\s,/]+/).filter((x) => x !== '')[3];
      return a === undefined ? 1 : parseFloat(a) / (a.endsWith('%') ? 100 : 1);
    }
    const a = hex.length === 4 ? hex.slice(3).repeat(2) : hex.length === 8 ? hex.slice(6) : 'ff';
    return parseInt(a, 16) / 255;
  });
}

/** The classes a selector requires of the element it styles (its last compound, `:global(...)` read through); null
 *  when the compound asks for anything else (a type, an attribute, a state), which no ghost is promised. */
function subjectOf(c: AST.CSS.ComplexSelector): string[] | null {
  const out: string[] = [];
  for (const s of c.children.at(-1)?.selectors ?? []) {
    const inner = s.type === 'PseudoClassSelector' && s.name === 'global' && s.args?.children.length === 1 ? s.args.children[0] : undefined;
    const got = s.type === 'ClassSelector' ? [s.name] : inner === undefined ? null : subjectOf(inner);
    if (got === null) {
      return null;
    }
    out.push(...got);
  }
  return out;
}

test('stage: a plain ghost paints', async () => {
  const layer = element('div', { 'data-cue-stage': '' }, STAGE);
  // (i) A plain box (no element to clone) carries the paint class.
  expect([...ghostOf(EDGE, null, layer).classList]).toEqual(['cue-ghost', 'cue-plain']);
  // (ii) CueStage's own CSS paints that class: a rule styling `.cue-ghost.cue-plain` declares a paint whose colour shows,
  // a soft light (peak alpha <= 0.5) with no motion of its own, so a reduced preset fades it like any ghost.
  const ast = parse(stageSource, { modern: true });
  const rules = (ast.css?.children ?? []).filter((r): r is AST.CSS.Rule => r.type === 'Rule');
  const plainRules = rules.filter((r) =>
    r.prelude.children.some((c) => {
      const classes = subjectOf(c);
      return classes !== null && classes.includes('cue-plain') && classes.every((k) => k === 'cue-ghost' || k === 'cue-plain');
    }),
  );
  const decls = plainRules.flatMap((r) => r.block.children.filter((d): d is AST.CSS.Declaration => d.type === 'Declaration'));
  const paint = decls.filter((d) => PAINT_PROPS.includes(d.property) && alphasOf(d.value).some((a) => a > 0));
  expect(paint.map((d) => d.property)).not.toEqual([]);
  expect(Math.max(...paint.flatMap((d) => alphasOf(d.value)))).toBeLessThanOrEqual(0.5);
  expect(decls.filter((d) => /^(animation|transition)/.test(d.property))).toEqual([]);
  // The reader is not vacuous: it finds the hit area's paint, and a transparent one is no paint.
  expect(rules.some((r) => r.prelude.children.some((c) => subjectOf(c)?.join('.') === 'cue-ghost.cue-hit'))).toBe(true);
  expect(alphasOf('transparent')).toEqual([]);
  expect(alphasOf('radial-gradient(rgba(255, 255, 255, 0), #fff0)')).toEqual([0, 0]);
  // (iii) A clone of a hit area, or of an element inside one, is the hit area's painted ghost; a clone of anything else
  // and a root's ghost (a clone of the painted room) keep their own paint.
  const hit = element('button', { 'data-cue': 'hotspot', 'data-cue-hit': '' });
  const label = element('span', {}, HOTSPOT, hit);
  expect([ghostOf(HOTSPOT, hit, layer), ghostOf(HOTSPOT, label, layer)].map((g) => g.classList.contains('cue-hit'))).toEqual([true, true]);
  const others = [element('button', { 'data-cue': 'bar-inventory' }), element('div', { 'data-cue-root': '' }, ROOT)];
  expect(others.map((of) => [...ghostOf(HOTSPOT, of, layer).classList])).toEqual([['cue-ghost'], ['cue-ghost']]);
  // (iv) Through the real stage: each effect cue of review r1 M1 plays on plain ghosts only (no ribbon, no inventory).
  document.body.replaceChildren();
  const s = mounted();
  const core = (name: string): Cue => ({ kind: 'module', module: 'core' as MechanicId, name, at: null, item: null });
  const cues: [Cue, Box | null][] = [
    [core('look'), HOTSPOT],
    [core('refused'), HOTSPOT],
    [core('reset'), null],
    [{ kind: 'move', from: null, to: null, via: null, how: 'walk' }, null],
    [held(), HOTSPOT],
    [added('doc', 'letter'), HOTSPOT],
  ];
  for (const [cue, box] of cues) {
    s.bus.emit(event(cue, box));
    await settle();
  }
  expect(s.played()).toEqual(['module:core:look', 'module:core:refused', 'module:core:reset', 'move:walk', 'fact:held:added', 'fact:doc:added']);
  expect(cueMotions().length).toBeGreaterThanOrEqual(cues.length);
  expect(cueMotions().filter((r) => !r.el.classList.contains('cue-plain'))).toEqual([]);
});

test('stage: a preset that paints by itself plays without the plain light', async () => {
  // Triage r1 I1: the light would lie over `vignette`'s inset shade and over `dim`'s colour, so a darkening brightened
  // the stage. A plain ghost whose keyframes paint it (a shade, a colour, a glow) shows that paint alone; reduced
  // motion's `fade` paints nothing, so the same ghost keeps the light there (RULINGS 203).
  const run = async (reduced: boolean): Promise<[Keyframe[], boolean][]> => {
    records = [];
    const s = mounted({ reduced });
    element('div', { 'data-cue-panel': 'lock' });
    const move = (how: 'enter' | 'leave'): Cue => ({ kind: 'move', from: null, to: null, via: null, how });
    const cues: [Cue, Box | null][] = [
      [move('enter'), null],
      [move('leave'), null],
      [added('story', 'note'), null],
      [uiState('panel-open', 'lock'), null],
      [added('fired', 'lamp'), HOTSPOT],
    ];
    for (const [cue, box] of cues) {
      s.bus.emit(event(cue, box));
      await settle();
    }
    expect(s.played()).toEqual(['move:enter', 'move:leave', 'fact:story:added', 'ui-state:panel-open@lock', 'fact:fired:added']);
    const ghosts = cueMotions().filter((r) => r.el.classList.contains('cue-ghost'));
    const out = ghosts.map((r): [Keyframe[], boolean] => [r.kf, r.el.classList.contains('cue-plain')]);
    s.unmount();
    document.body.replaceChildren();
    return out;
  };
  const full = await run(false);
  // The stage's shade and colour, the panel's dim and a box's glow: each on an unlit ghost (the panel's own `lift`
  // plays on the live sheet).
  expect(full.filter(([, lit]) => lit)).toEqual([]);
  expect(full.map(([kf]) => kf)).toEqual([PRESETS.vignette, PRESETS['vignette-back'], PRESETS.dim, PRESETS.dim, PRESETS.pulse]);
  const calm = await run(true);
  expect(calm).toEqual(Array.from({ length: 5 }, () => [PRESETS.fade, true]));
});

test('stage: a hold on a plain box plays without the plain light', async () => {
  // Triage r2 F1: a box-less hold (a room batch with no `via`, a frame's load with no notice) breathes at `centre` on
  // a plain ghost. `breathe` paints its own ring in its middle frame only, so the light comes off for any played
  // frame that paints, not only the first one or every one.
  const s = mounted();
  s.bus.emit(event(uiState('waiting', null)));
  s.bus.emit(event(uiState('waiting', 'puzzle')));
  await settle();
  vi.advanceTimersByTime(WAIT_DELAY_MS);
  const holds = cueMotions().filter((r) => r.el.classList.contains('cue-ghost'));
  expect(holds.map((r) => r.kf)).toEqual([PRESETS.breathe, PRESETS.breathe]);
  expect(holds.filter((r) => r.el.classList.contains('cue-plain'))).toEqual([]);
});

test('stage: a wait hold over a panel with a notice plays on the notice', async () => {
  // PuzzleHost's load-failed block inside the frame wrapper (the notice is a descendant of the panel).
  const s = mounted();
  const wrapper = element('div', { 'data-cue-frame': '', 'data-cue-panel': 'puzzle' }, ROOT);
  const notice = element('div', { 'data-cue-notice': '' }, HOTSPOT, wrapper);
  s.bus.emit(event(uiState('waiting', 'puzzle')));
  await settle();
  vi.advanceTimersByTime(WAIT_DELAY_MS);
  expect(cueMotions().map((r) => [r.el, r.kf])).toEqual([[notice, PRESETS.breathe]]);
  s.bus.emit(event(uiState('waited', 'puzzle')));
  await settle();
  expect(cueMotions().at(-1)?.el).toBe(notice);
  expect(cueMotions().at(-1)?.kf).toEqual(PRESETS.settle);
  // App's `.host-failed`: the panel carries both markers.
  wrapper.remove();
  const failed = element('div', { 'data-cue-notice': '', 'data-cue-panel': 'puzzle' });
  s.bus.emit(event(uiState('waiting', 'puzzle')));
  await settle();
  vi.advanceTimersByTime(WAIT_DELAY_MS);
  expect(cueMotions().at(-1)?.el).toBe(failed);
  expect(s.fallbacks()).toBe(0);
  expect(s.played()).toEqual(['ui-state:waiting@puzzle', 'ui-state:waited@puzzle', 'ui-state:waiting@puzzle']);
});

/** ExploreView's props over a new view store, as GameSession mounts the layer. */
function layerProps(): ExploreLayerProps {
  const view = createExploreView();
  const no = (): void => {};
  return {
    lang: 'en',
    view,
    actions: { ontap: no, oninventory: no, onreveal: no, onread: no, oninsert: no, onclose: no },
    puzzle: createPuzzleView(),
    puzzleActions: { item: () => null, onchange: no, ontry: no, ongiveup: no, onhint: no, onretry: no, onusehint: no, ongetmore: no },
  };
}

test("cues: the explore root attaches in an effect and emits to the view's oncue", async () => {
  // RULINGS 201 E1: ExploreView's root is the family's cue root without a `use:` action; its effect attaches the
  // root's listeners and stamps its birth, a second effect hands it the view's emit, and unmount detaches it.
  const props = layerProps();
  const first: CueEvent[] = [];
  props.view.oncue = (e) => first.push(e);
  const { unmount } = render(ExploreView, props);
  await settle();
  const layer = document.querySelector<HTMLElement>('[data-cue-root]');
  expect(Number.isFinite(Number(layer?.dataset.cueBorn))).toBe(true);
  const tap = element('button', { 'data-cue': 'hotspot' }, HOTSPOT, layer ?? document.body);
  tap.click();
  expect(first.map((e) => [e.cue, e.el])).toEqual([[{ kind: 'ui', control: 'hotspot', item: null, index: null }, tap]]);
  // A new emit (the next session's bus) reaches the next taps; the old one gets none.
  const next: CueEvent[] = [];
  props.view.oncue = (e) => next.push(e);
  await settle();
  tap.click();
  expect([first.length, next.length]).toEqual([1, 1]);
  // Unmounted: the listeners are gone with the root.
  unmount();
  await settle();
  tap.click();
  expect([first.length, next.length]).toEqual([1, 1]);
});

test('stage: a panel the write opens slides in after its flush and a panel it closes slides out on its ghost', async () => {
  const s = mounted();
  const props = layerProps();
  render(ExploreView, props);
  await settle();
  // One block, as yields writes a panel: the store and the cue.
  props.view.panel = { kind: 'inventory' };
  s.bus.emit(event(uiState('panel-open', 'inventory')));
  expect(document.querySelector('[data-cue-panel="inventory"]')).toBeNull();
  await settle();
  const sheet = document.querySelector('[data-cue-panel="inventory"]');
  expect(sheet).not.toBeNull();
  const [lift, dim] = cueMotions();
  expect([lift?.el, lift?.kf]).toEqual([sheet, PRESETS.lift]);
  expect(dim?.kf).toEqual(PRESETS.dim);
  // The close: caught on the wrapper at the emit, played on its ghost at the wrapper's box once the flush removed it.
  BOXES.set(sheet ?? s.layer, { x: 0, y: 300, w: 400, h: 300 });
  props.view.panel = null;
  s.bus.emit(event(uiState('panel-close', 'inventory')));
  await settle();
  expect(sheet?.isConnected).toBe(false);
  const settled = cueMotions().at(-1);
  expect(settled?.kf).toEqual(PRESETS.settle);
  expect(settled?.el.classList.contains('cue-ghost')).toBe(true);
  expect(settled?.el.isConnected).toBe(true);
  expect(settled === undefined ? null : boxOfGhost(settled.el)).toEqual({ x: 0, y: 300, w: 400, h: 300 });
  expect(s.fallbacks()).toBe(0);
  vi.advanceTimersByTime(300);
  expect(s.layer.querySelectorAll('.cue-ghost:not(.cue-root-ghost)')).toHaveLength(0);
});

test('stage: a ribbon or inventory target with no live control lands at the edge', async () => {
  const s = mounted();
  // No ribbon on screen (the dispatch hid the rooms, or none exists yet): the gift flies to `edge`; the slot's
  // `pulse` (an element-site motion) is skipped there.
  s.bus.emit(event(held(), HOTSPOT));
  await settle();
  expect(cueMotions()).toHaveLength(1);
  const [fly] = cueMotions();
  expect(fly?.ms).toBe(480);
  expect(fly === undefined ? null : boxOfGhost(fly.el)).toEqual(EDGE);
  // A document with no live Inventory control: the same landing; a clone on the stage layer is not live.
  element('button', { 'data-cue': 'bar-inventory' }, HOTSPOT, s.layer);
  s.bus.emit(event(added('doc', 'letter'), HOTSPOT));
  await settle();
  const doc = cueMotions().at(-1);
  expect(doc === undefined ? null : boxOfGhost(doc.el)).toEqual(EDGE);
  // A live control is the target: the fly ends on its box.
  element('button', { 'data-cue': 'bar-inventory' }, { x: 300, y: 540, w: 48, h: 48 });
  s.bus.emit(event(added('doc', 'map'), HOTSPOT));
  await settle();
  expect(cueMotions().slice(-2).map((r) => r.kf)).toEqual([expect.anything(), PRESETS.pulse]);
  expect(s.fallbacks()).toBe(0);
  expect(landing(s.layer, 'edge')).toEqual(EDGE);
});

test('stage: a box-less hold lands at centre and a missing panel counts', async () => {
  const s = mounted();
  // A room batch with no `via` and a frame's load with no notice breathe at `centre` (72 x 72, the player's own).
  s.bus.emit(event(uiState('waiting', null)));
  s.bus.emit(event(uiState('waiting', 'puzzle')));
  await settle();
  vi.advanceTimersByTime(WAIT_DELAY_MS);
  expect(cueMotions().map((r) => boxOfGhost(r.el))).toEqual([CENTRE, CENTRE]);
  expect(landing(s.layer, 'centre')).toEqual(CENTRE);
  expect(s.fallbacks()).toBe(0);
  // A hold of a panel that is not on screen resolves nothing: played at the stage centre and counted.
  s.bus.emit(event(uiState('waiting', 'inventory')));
  await settle();
  vi.advanceTimersByTime(WAIT_DELAY_MS);
  expect(boxOfGhost(cueMotions().at(-1)?.el ?? s.layer)).toEqual(CENTRE);
  expect(s.fallbacks()).toBe(1);
});

test('stage: a haptic plays only on top of a motion', async () => {
  const s = mounted();
  // K51's take and refused insert: their rows' haptics, through the stage (yields plays none of its own).
  s.bus.emit(event(held(), HOTSPOT));
  s.bus.emit(event({ kind: 'module', module: 'core' as MechanicId, name: 'refused', at: null, item: 'key' as ItemId }, HOTSPOT));
  await settle();
  expect(s.haptics).toEqual(['notify:success', 'notify:error']);
  // A select with no ribbon: its `lift` is skipped at `edge`, so its `light` impact does not play alone.
  s.bus.emit(event(uiState('select', null)));
  await settle();
  expect(cueMotions()).toHaveLength(2);
  expect(s.haptics).toEqual(['notify:success', 'notify:error']);
});

// ---------------------------------------------------------------------------------------------------------------
// The family roots' entrance and exit (RULINGS 195: F2-F7, F10)

/** A family root as a family mounts it: the action applied, the node in the document. */
function familyRoot(kind: '' | 'frame', bus: CueBus | null = null): HTMLElement {
  const el = element('div', { 'data-cue-root': kind }, ROOT);
  cueRoot(el, bus?.emit);
  return el;
}

test('stage: a family root enters and leaves with LAYER_MOTIONS', async () => {
  // A root older than its entrance when the stage mounts gets none.
  const old = familyRoot('');
  vi.advanceTimersByTime(LAYER_MOTIONS.in.ms + 100);
  const s = mounted();
  await settle();
  expect(records).toEqual([]);
  // A root born now enters on its live element.
  const room = familyRoot('');
  await settle();
  expect(records.map((r) => [r.el, r.kf, r.ms, r.fill])).toEqual([[room, LAYER_MOTIONS.in.keyframes, 300, 'none']]);
  vi.advanceTimersByTime(300);
  // Removed: one ghost on the stage layer at the root's last box plays `out` and leaves at its finish.
  BOXES.set(room, { x: 0, y: 0, w: 400, h: 600 });
  s.bus.emit(event(held(), HOTSPOT));
  room.remove();
  await settle();
  const ghosts = s.layer.querySelectorAll('.cue-root-ghost');
  expect(ghosts).toHaveLength(1);
  const exit = records.find((r) => r.el === ghosts[0]);
  expect([exit?.kf, exit?.ms, exit?.fill]).toEqual([LAYER_MOTIONS.out.keyframes, 300, 'forwards']);
  expect(boxOfGhost(ghosts[0] ?? s.layer)).toEqual({ x: 0, y: 0, w: 400, h: 600 });
  vi.advanceTimersByTime(300);
  expect(s.layer.querySelectorAll('.cue-root-ghost')).toHaveLength(0);
  // The frame's root leaves with `frameOut`; the old root's exit plays too.
  const frame = familyRoot('frame');
  await settle();
  old.remove();
  frame.remove();
  await settle();
  const exits = records.filter((r) => r.el.classList.contains('cue-root-ghost')).slice(-2);
  expect(exits.map((r) => [r.kf, r.ms])).toEqual([
    [LAYER_MOTIONS.out.keyframes, 300],
    [LAYER_MOTIONS.frameOut.keyframes, 480],
  ]);
  // Unmounted mid-exit: no ghost is left and every layer animation is cancelled.
  s.unmount();
  expect(document.querySelectorAll('.cue-ghost')).toHaveLength(0);
  expect(records.filter((r) => r.anim.playState === 'running')).toEqual([]);
  expect(records.filter((r) => r.el.classList.contains('cue-root-ghost')).slice(-2).map((r) => r.anim.playState)).toEqual(['idle', 'idle']);

  // Reduced motion: the fades, with `frameOut`'s own length.
  records = [];
  const r = mounted({ reduced: true });
  const quiet = familyRoot('frame');
  await settle();
  quiet.remove();
  await settle();
  expect(records.map((x) => [x.kf, x.ms])).toEqual([
    [LAYER_MOTIONS.in.reduced.keyframes, 150],
    [LAYER_MOTIONS.frameOut.reduced.keyframes, 480],
  ]);
  r.unmount();
});

test("stage: an end motion continues on the wrapper's clone inside its root's ghost", async () => {
  const s = mounted();
  const family = familyRoot('frame', s.bus);
  const wrapper = element('div', { 'data-cue-frame': '', 'data-cue-panel': 'puzzle' }, ROOT, family);
  const button = element('button', { 'data-cue': 'puzzle-try' }, HOTSPOT, wrapper);
  await settle();
  vi.advanceTimersByTime(300);
  records = [];
  // One block: the run fails, the player's tap is the frame's Try, and the frame leaves.
  s.bus.emit(event({ kind: 'puzzle', puzzle: P, name: 'failed', index: null }));
  button.click();
  family.remove();
  await settle();
  const rootGhost = s.layer.querySelector('.cue-root-ghost');
  expect(rootGhost).not.toBeNull();
  const exit = records.find((r) => r.el === rootGhost);
  expect([exit?.kf, exit?.ms]).toEqual([LAYER_MOTIONS.frameOut.keyframes, 480]);
  // `jam` holds its end on the wrapper's clone inside the root's ghost (RULINGS 135 (b)).
  const jam = records.find((r) => r.kf === PRESETS.jam || JSON.stringify(r.kf) === JSON.stringify(PRESETS.jam));
  expect(jam?.el.closest('.cue-root-ghost')).toBe(rootGhost);
  expect(jam?.el).toBe(rootGhost?.children[0]);
  expect(jam?.fill).toBe('forwards');
  // The tap's press plays inside the root's ghost too, held to the ghost's end (F7: a timing value; happy-dom and this
  // fake do not re-time a finish on `updateTiming`, critique O3).
  const press = records.find((r) => JSON.stringify(r.kf) === JSON.stringify(PRESETS.press));
  expect(press?.el).toBe(rootGhost?.children[0]?.children[0]);
  expect(press?.anim.timing.endDelay).toBe(480);
  expect((press?.ms ?? 0) + (press?.anim.timing.endDelay ?? 0)).toBeGreaterThanOrEqual(480);
  // Nothing animates a connected original or a family root; nothing fell back.
  expect(records.filter((r) => r !== exit && (r.el.closest('[data-cue-root]') !== null || !r.el.isConnected))).toEqual([]);
  expect(s.layer.querySelectorAll('.cue-ghost:not(.cue-root-ghost)')).toHaveLength(0);
  expect(s.fallbacks()).toBe(0);
  expect(s.played()).toEqual(['puzzle:failed', 'ui:puzzle-try']);
});

// ---------------------------------------------------------------------------------------------------------------
// App's cue layer and the frame's notice (§8.1, §8.5), read on the compiler's own tree

/** A markup element or a component on the compiler's tree. */
type MarkupEl = AST.RegularElement | AST.Component;

/** Every element and component under `node`, in document order. */
function elementsOf(node: unknown): MarkupEl[] {
  const out: MarkupEl[] = [];
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) {
      return;
    }
    const t = (n as { type?: unknown }).type;
    if (t === 'RegularElement' || t === 'Component') {
      out.push(n as MarkupEl);
    }
    for (const v of Object.values(n)) {
      walk(v);
    }
  };
  walk(node);
  return out;
}

test("stage: App's host-failed notice and Retry carry their cue markers", () => {
  const ast = parse(appSource, { modern: true });
  const els = elementsOf(ast.fragment);
  /** An element's attributes as written. */
  const attrs = (el: MarkupEl | undefined): string[] => (el?.attributes ?? []).map((a) => appSource.slice(a.start, a.end));
  const byClass = (cls: string): MarkupEl[] => els.filter((el) => attrs(el).includes(`class="${cls}"`));
  // The frame's load notice is its panel's notice (§8.5 "Cue targets"); its Retry is a control outside every root.
  const [failed, ...moreFailed] = byClass('host-failed');
  expect(moreFailed).toEqual([]);
  expect(attrs(failed)).toEqual(expect.arrayContaining(['data-cue-notice', 'data-cue-panel="puzzle"']));
  const retry = elementsOf(failed?.fragment).find((el) => el.name === 'button');
  expect(attrs(retry)).toEqual(expect.arrayContaining(['data-cue="puzzle-retry"', 'disabled={frame.retrying}']));
  // The stage layer stays inert under a frame (GM3w tester T1).
  expect(els.filter((el) => attrs(el).includes("inert={root !== 'game' || covered || ui.puzzle.covers}"))).toHaveLength(1);
  // One cue layer, after the frame layer and before Home's: its stage gets the slot's props and the reduced setting.
  const [frameLayer] = byClass('layer frame-layer');
  const [cueLayer, ...moreCue] = byClass('layer cue-layer');
  expect(moreCue).toEqual([]);
  expect((cueLayer?.start ?? 0) > (frameLayer?.start ?? Infinity)).toBe(true);
  expect(appSource.indexOf("{#if root === 'home'}")).toBeGreaterThan(cueLayer?.end ?? Infinity);
  const stage = elementsOf(cueLayer?.fragment).filter((el) => el.type === 'Component');
  expect(stage).toHaveLength(1);
  expect(attrs(stage[0]).sort()).toEqual(
    [
      'dropped={cue.dropped}',
      'haptic={cue.haptic}',
      'host={cue.host}',
      'orphans={cue.orphans}',
      'reduced={vm.reducedMotion}',
      'subscribe={cue.subscribe}',
    ].sort(),
  );
  // The layer itself takes no tap (critique O2): every tap reaches the layers below it.
  const rules = (ast.css?.children ?? []).filter((r): r is AST.CSS.Rule => r.type === 'Rule');
  const cueRule = rules.find((r) => appSource.slice(r.prelude.start, r.prelude.end).trim() === '.cue-layer');
  const decls = (cueRule?.block.children ?? []).filter((d): d is AST.CSS.Declaration => d.type === 'Declaration');
  expect(decls.map((d) => [d.property, d.value])).toEqual([['pointer-events', 'none']]);
});
