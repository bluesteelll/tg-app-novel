// The cue stage (engine plan §8.1, §8.3, §8.5; GM3s): the family root's emission, and no Svelte transition directive
// (RULINGS 195's fallback: the layer roots enter and leave as cue-stage motions). A fixture DOM in happy-dom.
import { expect, test } from 'vitest';

import { cueRoot } from '../root.ts';
import type { CueEvent } from '../types.ts';

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
