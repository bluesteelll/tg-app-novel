// The overlay pads by `--app-inset-<side>`: the device safe area plus Telegram's own content safe area (its header
// in fullscreen). TWA keeps the `--tg-*` inputs live on `safeAreaChanged` / `contentSafeAreaChanged`, so the sums
// are written once at boot and follow by CSS. The height is `--tg-viewport-stable-height` on `#app` (index.html),
// never a viewport-height unit (principle 5).
// Q67: App's root is one phone-shaped column (its shape lives in CSS: index.html and App.svelte). A column narrower
// than the design width lays its layers out at that width and draws them scaled down as one unit; the only number
// JS supplies is that scale, `--col-scale` on the column, kept by `fitColumn`.

/** Where the variables go: `document.documentElement.style` in the page. */
export type StyleTarget = { setProperty(name: string, value: string): void };

type Side = 'top' | 'bottom' | 'left' | 'right';

const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];

/** The four `--app-inset-*` declarations, each falling back to 0px while TWA has not set its inputs. */
export function insetVars(): ReadonlyArray<readonly [name: `--app-inset-${Side}`, value: string]> {
  return SIDES.map(
    (side) =>
      [
        `--app-inset-${side}`,
        `calc(var(--tg-safe-area-inset-${side}, 0px) + var(--tg-content-safe-area-inset-${side}, 0px))`,
      ] as const,
  );
}

/** Writes the inset sums once; call at boot. */
export function applyInsetVars(style: StyleTarget): void {
  for (const [name, value] of insetVars()) {
    style.setProperty(name, value);
  }
}

/** Q67: the width, in CSS px, the UI is laid out for; a narrower column draws its layers at this width, scaled down. */
export const DESIGN_WIDTH = 360;

/** Q67: the column's layer scale at column width `w`: w / DESIGN_WIDTH below the design width, else 1 (also for a
 *  width that is not a positive finite number: a box not laid out). */
export function columnScale(w: number): number {
  return w > 0 && w < DESIGN_WIDTH ? w / DESIGN_WIDTH : 1;
}

/** Q67: keeps `--col-scale` on `column` (App's root) at columnScale(its content-box width), removed when that is 1,
 *  on every size change of the column (Telegram's height, the window); returns the stop, which disconnects it. */
export function fitColumn(column: HTMLElement): () => void {
  // The layout width (`contentRect`, fractional), never the drawn one: the scale applies inside the column, so the
  // column's own box never depends on it and an observation never feeds back.
  const observer = new ResizeObserver((entries) => {
    for (const e of entries) {
      const s = columnScale(e.contentRect.width);
      if (s < 1) {
        column.style.setProperty('--col-scale', String(s));
      } else {
        column.style.removeProperty('--col-scale');
      }
    }
  });
  observer.observe(column);
  return () => observer.disconnect();
}
