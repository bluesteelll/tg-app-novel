// Pixi's environment extensions (RULINGS 201, lever X): `Application.init()` imports them dynamically, through
// `loadEnvironmentExtensions`, unless the renderer options say `skipExtensionImports`. The browser's one pulls Pixi's
// events, accessibility, DOM pipe and filters; the app uses none of them (input is the DOM overlay's, the stage is
// `eventMode = 'none'`, accessibility is off). Rule `pixi-env` (arch.test.ts) keeps scene code off the systems the
// skip drops, and carries the recipe for importing one back. The budget's engine walk stops at these chunks only
// while SKIP_PIXI_ENV holds, so with the flag off they are counted again (the fail-safe).
// Read by scene/controller.ts (`appOptions`), and in Node by scripts/budget.ts (through scripts/assets/manifest.ts)
// and the e2e: pure, no import, so pixi.js never loads there.
// On a Pixi upgrade (8.22.0 now), re-check both srcs against node_modules/pixi.js/lib and the build's manifest: a
// renamed src stops nothing, so the engine row rises by the chunks again, visibly.

/** Pixi's environment extensions (events, accessibility, DOM pipe, filters) are not imported; see rule pixi-env. */
export const SKIP_PIXI_ENV: boolean = true;
/** The manifest `src` of Pixi's environment chunks; the budget walk stops there only while SKIP_PIXI_ENV holds. */
export const PIXI_ENV_SRCS: readonly string[] = [
  'node_modules/pixi.js/lib/environment-browser/browserAll.mjs',
  'node_modules/pixi.js/lib/environment-webworker/webworkerAll.mjs',
];
