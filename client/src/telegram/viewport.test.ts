// Q67: the column's layer scale and the observer that keeps it on App's root, over a fake ResizeObserver and a fake
// column: the unit project runs in node, which has no layout. The layout itself is pinned by e2e/layout.spec.ts.
import { afterEach, expect, test, vi } from 'vitest';

import { columnScale, fitColumn } from './viewport.ts';

type Entry = { readonly contentRect: { readonly width: number } };

/** A fake ResizeObserver: the test delivers observations by hand; like the real one, none after `disconnect`. */
function stubObserver(): { observed: unknown[]; disconnects: () => number; deliver: (...widths: number[]) => void } {
  const observed: unknown[] = [];
  let disconnects = 0;
  let callback: ((entries: Entry[]) => void) | null = null;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: (entries: Entry[]) => void) {
        callback = cb;
      }
      observe(el: unknown): void {
        observed.push(el);
      }
      disconnect(): void {
        disconnects += 1;
        callback = null;
      }
    },
  );
  return {
    observed,
    disconnects: () => disconnects,
    deliver: (...widths) => callback?.(widths.map((width) => ({ contentRect: { width } }))),
  };
}

/** App's root as far as the fit touches it: its inline style. */
function fakeColumn(): { el: HTMLElement; setProperty: ReturnType<typeof vi.fn>; removeProperty: ReturnType<typeof vi.fn> } {
  const setProperty = vi.fn();
  const removeProperty = vi.fn();
  // A structural fake: the fit only writes the element's inline style and hands the element to the observer.
  const el = { style: { setProperty, removeProperty } } as unknown as HTMLElement;
  return { el, setProperty, removeProperty };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('viewport: columnScale is 1 from the design width up', () => {
  for (const w of [360, 390, 405, 1e4]) {
    expect(columnScale(w), String(w)).toBe(1);
  }
});

test('viewport: columnScale shrinks a narrower column in proportion', () => {
  // 1000 x 473 and 812 x 375 (landscape columns), a 320 px phone, the owner's 642 x 435 pane, a 500 x 400 window.
  expect(columnScale(266.0625)).toBe(0.7390625);
  expect(columnScale(210.9375)).toBe(0.5859375);
  expect(columnScale(320)).toBe(8 / 9);
  expect(columnScale(244.6875)).toBe(0.6796875);
  expect(columnScale(225)).toBe(0.625);
});

test('viewport: columnScale leaves a box that is not laid out unscaled', () => {
  for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(columnScale(w), String(w)).toBe(1);
  }
});

test('viewport: fitColumn writes the scale on a resize and removes it at the design width', () => {
  const ro = stubObserver();
  const col = fakeColumn();
  fitColumn(col.el);
  expect(ro.observed).toEqual([col.el]);
  ro.deliver(266.0625);
  expect(col.setProperty).toHaveBeenCalledWith('--col-scale', '0.7390625');
  ro.deliver(390);
  expect(col.removeProperty).toHaveBeenCalledWith('--col-scale');
  // The last write wins: the removal follows the write.
  const [set] = col.setProperty.mock.invocationCallOrder;
  const [removed] = col.removeProperty.mock.invocationCallOrder;
  expect(col.setProperty).toHaveBeenCalledTimes(1);
  expect(col.removeProperty).toHaveBeenCalledTimes(1);
  expect(Number(removed)).toBeGreaterThan(Number(set));
});

test("viewport: fitColumn's stop disconnects its observer", () => {
  const ro = stubObserver();
  const col = fakeColumn();
  const stop = fitColumn(col.el);
  stop();
  expect(ro.disconnects()).toBe(1);
  ro.deliver(266.0625);
  expect(col.setProperty).not.toHaveBeenCalled();
  expect(col.removeProperty).not.toHaveBeenCalled();
});
