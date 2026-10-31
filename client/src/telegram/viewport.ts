// The overlay pads by `--app-inset-<side>`: the device safe area plus Telegram's own content safe area (its header
// in fullscreen). TWA keeps the `--tg-*` inputs live on `safeAreaChanged` / `contentSafeAreaChanged`, so the sums
// are written once at boot and follow by CSS. The height is `--tg-viewport-stable-height` on `#app` (index.html),
// never a viewport-height unit (principle 5).

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
