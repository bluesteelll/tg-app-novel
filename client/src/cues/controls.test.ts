// The control gate (engine plan §8.3 "Declaration", "Gate", "Gesture input"; GM3u): every element of the explore UI
// that handles an event declares the cue it emits, so the family root's one listener per trigger (`cues/root.ts`) speaks
// for every control and no tap is silent on the cue stage. Read on the compiler's own tree (`parse(src, { modern: true })`,
// the shape stage.svelte.test.ts reads App.svelte with): a `RegularElement` with an event attribute carries either a
// literal `data-cue` from the control set, whose trigger (`data-cue-on`, omitted = `click`) is one of its own handler
// events (W5), or a literal `data-cue-gesture` from the gesture set on a surface that disables touch panning (m13).
// Components are not elements: their own files are scanned. GM3p extends the scan to the puzzle families.
import { parse } from 'svelte/compiler';
import type { AST } from 'svelte/compiler';
import { expect, test } from 'vitest';

import archSource from '../arch.test.ts?raw';
import { declaredControls } from './stage/motions.ts';
import { CORE_CONTROLS, CUE_TRIGGERS } from './types.ts';

/** The event attributes a control may handle (§8.3 "Declaration"). */
const EVENT_ATTRS = ['onclick', 'onpointerdown', 'onpointerup', 'onpointermove', 'onkeydown', 'oninput', 'onchange'] as const;

/** The literal sets a declaration is held to: `ControlCue` and `GestureCue` as data. */
type Known = { readonly controls: ReadonlySet<string>; readonly gestures: ReadonlySet<string> };

/** The registries' sets: the core controls and every declared control; the gestures are the declared `gesture` ones. */
const KNOWN: Known = {
  controls: new Set<string>([...CORE_CONTROLS, ...declaredControls().map((d) => d.name)]),
  gestures: new Set(declaredControls().filter((d) => d.on === 'gesture').map((d) => d.name)),
};

/** What one file holds: its elements with an event attribute, and the findings of each rule. */
type Scan = { readonly controls: number; readonly declaration: readonly string[]; readonly gesture: readonly string[] };

/** Every element under `node`, in document order; a component is walked through, never counted. */
function elementsOf(node: unknown): AST.RegularElement[] {
  const out: AST.RegularElement[] = [];
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) {
      return;
    }
    if ((n as { type?: unknown }).type === 'RegularElement') {
      out.push(n as AST.RegularElement);
    }
    for (const v of Object.values(n)) {
      walk(v);
    }
  };
  walk(node);
  return out;
}

/** An attribute's literal value (`true` for a bare attribute is ''), or null when any part of it is an expression. */
function literal(value: AST.Attribute['value'] | AST.StyleDirective['value']): string | null {
  if (value === true) {
    return '';
  }
  const parts = Array.isArray(value) ? value : [value];
  return parts.every((p) => p.type === 'Text') ? parts.map((p) => (p as AST.Text).data).join('') : null;
}

/** The declaration and gesture rules over one component's markup. */
function scan(file: string, source: string, known: Known = KNOWN): Scan {
  const ast = parse(source, { modern: true });
  const declaration: string[] = [];
  const gesture: string[] = [];
  let controls = 0;
  for (const el of elementsOf(ast.fragment)) {
    const attrs = new Map<string, AST.Attribute>();
    for (const a of el.attributes) {
      if (a.type === 'Attribute') {
        attrs.set(a.name, a);
      }
    }
    const events = EVENT_ATTRS.filter((name) => attrs.has(name)).map((name) => name.slice(2));
    if (events.length === 0) {
      continue;
    }
    controls += 1;
    const at = `${file}:${source.slice(0, el.start).split('\n').length}: <${el.name}>`;
    const cue = attrs.get('data-cue');
    const surface = attrs.get('data-cue-gesture');
    if (surface !== undefined) {
      const name = literal(surface.value);
      if (name === null || !known.gestures.has(name)) {
        gesture.push(`${at} data-cue-gesture ${name === null ? 'is not a literal' : `"${name}" is no GestureCue`}`);
      }
      const panning = el.attributes.find((a): a is AST.StyleDirective => a.type === 'StyleDirective' && a.name === 'touch-action');
      if (panning === undefined || literal(panning.value) !== 'none') {
        gesture.push(`${at} a gesture surface without style:touch-action="none"`);
      }
      continue;
    }
    if (cue === undefined) {
      declaration.push(`${at} handles ${events.join(', ')} with no data-cue`);
      continue;
    }
    const name = literal(cue.value);
    if (name === null || !known.controls.has(name)) {
      declaration.push(`${at} data-cue ${name === null ? 'is not a literal' : `"${name}" is no ControlCue`}`);
    }
    const onAttr = attrs.get('data-cue-on');
    const on = onAttr === undefined ? 'click' : literal(onAttr.value);
    if (on === null || !(CUE_TRIGGERS as readonly string[]).includes(on)) {
      declaration.push(`${at} data-cue-on ${on === null ? 'is not a literal' : `"${on}" is no CueTrigger`}`);
    } else if (!events.includes(on)) {
      declaration.push(`${at} declares ${on} but handles ${events.join(', ')}`);
    }
  }
  return { controls, declaration, gesture };
}

/** `LAZY_COMPONENTS` as arch.test.ts lists it (read from its source: the constant is not exported, and importing the
 *  test file would run its tests here). */
function lazyComponents(): string[] {
  const list = /const LAZY_COMPONENTS = \[([\s\S]*?)\] as const;/.exec(archSource)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

const EXPLORE_SOURCES = import.meta.glob<string>('../ui/explore/*.svelte', { query: '?raw', import: 'default', eager: true });
const PUZZLE_SOURCES = {
  ...import.meta.glob<string>('../ui/puzzles/*.svelte', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../puzzles/ui/*.svelte', { query: '?raw', import: 'default', eager: true }),
};

/** A glob's sources keyed as `LAZY_COMPONENTS` names them (`ui/explore/X.svelte`), in name order. */
const byName = (sources: Readonly<Record<string, string>>): Array<[string, string]> =>
  Object.entries(sources)
    .map(([path, source]): [string, string] => [path.replace(/^\.\.\//, ''), source])
    .sort(([a], [b]) => a.localeCompare(b));

test('explore: every control declares its cue', () => {
  const files = byName(EXPLORE_SOURCES);
  // Non-vacuous: exactly the explore family's lazy components are scanned, each with at least one control.
  expect(files.map(([name]) => name)).toEqual(lazyComponents().filter((f) => f.startsWith('ui/explore/')).sort((a, b) => a.localeCompare(b)));
  const findings: string[] = [];
  for (const [name, source] of files) {
    const s = scan(name, source);
    expect(s.controls, name).toBeGreaterThan(0);
    findings.push(...s.declaration, ...s.gesture);
  }
  expect(findings).toEqual([]);
});

test('controls: the gate refuses an undeclared handler, a foreign trigger and an unknown cue', () => {
  const f = (markup: string): readonly string[] => scan('F.svelte', `<script lang="ts">\n  const f = (): void => {};\n</script>\n${markup}`).declaration;
  // Declared: a click control, a pointerdown control with its trigger, a keyed control's index and item; a component
  // and an element with no handler are not controls.
  expect(f('<button data-cue="hotspot" onclick={f}></button>')).toEqual([]);
  expect(f('<button data-cue="dial-up" data-cue-on="pointerdown" data-cue-index={2} onpointerdown={f}></button>')).toEqual([]);
  expect(f('<button data-cue="lock-item" data-cue-item={id} onclick={f}></button>')).toEqual([]);
  expect(scan('F.svelte', '<Foo onclick={f} /><div class="x"></div>')).toEqual({ controls: 0, declaration: [], gesture: [] });
  // Refused, each with its line: a handler with no declaration, a trigger the element does not handle (W5) or that is no
  // trigger, a name outside the control set, and a name that is not a literal.
  expect(f('<div>\n  <button onclick={f}></button>\n</div>')).toEqual(['F.svelte:5: <button> handles click with no data-cue']);
  expect(f('<button data-cue="dial-up" onpointerdown={f}></button>')).toEqual(['F.svelte:4: <button> declares click but handles pointerdown']);
  expect(f('<button data-cue="hotspot" data-cue-on="keydown" onclick={f}></button>')).toEqual(['F.svelte:4: <button> declares keydown but handles click']);
  expect(f('<button data-cue="hotspot" data-cue-on="hover" onclick={f}></button>')).toEqual(['F.svelte:4: <button> data-cue-on "hover" is no CueTrigger']);
  expect(f('<button data-cue="tap" onclick={f}></button>')).toEqual(['F.svelte:4: <button> data-cue "tap" is no ControlCue']);
  expect(f('<button data-cue={name} onclick={f}></button>')).toEqual(['F.svelte:4: <button> data-cue is not a literal']);
  // Every event attribute of §8.3 makes a control; a handler inside a component's slot is still an element's.
  for (const attr of EVENT_ATTRS) {
    expect(f(`<input ${attr}={f} />`), attr).toEqual([`F.svelte:4: <input> handles ${attr.slice(2)} with no data-cue`]);
  }
  expect(f('<Foo>\n  <button onclick={f}></button>\n</Foo>')).toEqual(['F.svelte:5: <button> handles click with no data-cue']);
});

test('puzzles: every gesture surface disables touch panning', () => {
  // The gesture rule over every family's lazy components (none draws a stroke yet; GM7p's path surface will).
  const files = [...byName(EXPLORE_SOURCES), ...byName(PUZZLE_SOURCES)];
  const families = ['ui/explore/', 'ui/puzzles/', 'puzzles/ui/'];
  expect(files.map(([name]) => name).sort((a, b) => a.localeCompare(b))).toEqual(
    lazyComponents()
      .filter((f) => families.some((dir) => f.startsWith(dir)))
      .sort((a, b) => a.localeCompare(b)),
  );
  expect(files.flatMap(([name, source]) => scan(name, source).gesture)).toEqual([]);
  // Fixture surfaces over a fixture gesture set: the stroke's surface with `touch-action: none` passes; without it, or
  // with another value, or with a name outside the set, it is refused.
  const known: Known = { controls: KNOWN.controls, gestures: new Set(['path-stroke']) };
  const g = (markup: string): readonly string[] => scan('G.svelte', markup, known).gesture;
  expect(g('<div data-cue-gesture="path-stroke" style:touch-action="none" onpointerdown={f} onpointermove={f}></div>')).toEqual([]);
  expect(g('<div data-cue-gesture="path-stroke" onpointerdown={f}></div>')).toEqual(['G.svelte:1: <div> a gesture surface without style:touch-action="none"']);
  expect(g('<div data-cue-gesture="path-stroke" style:touch-action="manipulation" onpointerdown={f}></div>')).toEqual([
    'G.svelte:1: <div> a gesture surface without style:touch-action="none"',
  ]);
  expect(g('<div data-cue-gesture="swipe" style:touch-action="none" onpointerdown={f}></div>')).toEqual(['G.svelte:1: <div> data-cue-gesture "swipe" is no GestureCue']);
  // A surface needs no `data-cue`: the declaration rule leaves it to this one.
  expect(scan('G.svelte', '<div data-cue-gesture="path-stroke" style:touch-action="none" onpointerdown={f}></div>', known).declaration).toEqual([]);
});
