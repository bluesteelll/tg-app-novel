import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { buildIdFile, buildIdOf } from './scripts/build-id.ts';
import { PIXI_ENV_SRCS, SKIP_PIXI_ENV } from './src/scene/pixi-env.ts';
import { tgDevMock } from './vite-plugins/tg-dev-mock.ts';

const CLIENT_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * server-dev's rule (server/dev/src/main.rs `dev_addr`): unset or empty takes the default; anything else must be a
 * decimal port 1..65535, never a silent fallback onto another lane's port.
 */
function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a port number 1..=65535, got ${JSON.stringify(raw)}`);
  }
  return port;
}

/** A module id with '/' separators, as `path.resolve` gives it on Windows. */
const slashes = (id: string): string => id.replaceAll('\\', '/');

/** Pixi's renderer chooser (8.22.0) and the three renderers it imports dynamically, each once (Q60 G3). */
const AUTO_DETECT = '/node_modules/pixi.js/lib/rendering/renderers/autoDetectRenderer.mjs';
const RENDERERS: readonly string[] = [
  './gpu/WebGPURenderer.mjs',
  './gl/WebGLRenderer.mjs',
  './canvas/CanvasRenderer.mjs',
];

/**
 * Q60 G2 + G3 (build only): the engine's chunk waits on no Pixi chunk of its own. Rolldown gives a module that several
 * entries reach a common chunk of its own; Pixi's environment modules and its three renderers are such entries.
 * - G2: no path requests the environment modules while SKIP_PIXI_ENV holds (rule pixi-env), so they load empty then;
 *   their ids, and so their manifest keys, stay (the budget's engine walk and scene-env.spec.ts read them). With the
 *   flag off they load as they are.
 * - G3: autoDetectRenderer's three renderer import()s become static imports. The renderers' code is in the engine chunk
 *   already, and the chooser still picks the same one. Anything but exactly three replaced fails the build, so a Pixi
 *   upgrade cannot undo it silently.
 */
function pixiChunking(): Plugin {
  const envIds = new Set(PIXI_ENV_SRCS.map((src) => slashes(path.resolve(CLIENT_DIR, src))));
  return {
    name: 'novel:pixi-chunking',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      return SKIP_PIXI_ENV && envIds.has(slashes(id)) ? 'export {};' : null;
    },
    transform(code, id) {
      if (!slashes(id).endsWith(AUTO_DETECT)) {
        return null;
      }
      const statics: string[] = [];
      let out = code;
      for (const [i, spec] of RENDERERS.entries()) {
        const dynamic = `import('${spec}')`;
        if (out.split(dynamic).length !== 2) {
          throw new Error(`novel:pixi-chunking: ${AUTO_DETECT} has not exactly one ${dynamic} (Q60 G3, this Pixi)`);
        }
        statics.push(`import * as novelRenderer${i} from '${spec}';`);
        out = out.replace(dynamic, `Promise.resolve(novelRenderer${i})`);
      }
      return { code: `${statics.join('\n')}\n${out}`, map: null };
    },
  };
}

export default defineConfig(({ mode, command }) => {
  // K25: the dev mock exists in every mode but production (the dev server, vitest, `--mode e2e`).
  const mock = mode !== 'production';
  // LBI D1: one id per build, compiled in and written beside the bundle; the dev server, vitest and `vite preview`
  // (all `serve`) have none, so such a page never reports a build skew.
  const buildId = command === 'build' ? buildIdOf(CLIENT_DIR, mode) : null;
  // K27: the page and the API share one origin; the dev and preview servers forward to server-dev.
  const api = `http://127.0.0.1:${envPort('DEV_API_PORT', 8787)}`;
  const proxy = { '/api/': api, '/dev/': api, '/telegram/': api };
  return {
    // svelteTesting() only acts under vitest (browser resolve condition, auto-cleanup); builds are unaffected.
    plugins: [
      svelte(),
      svelteTesting(),
      ...(mock ? [tgDevMock()] : []),
      ...(buildId === null ? [] : [buildIdFile(buildId)]),
      pixiChunking(),
    ],
    // Production compiles `if (__TG_MOCK__)` and the mock chunk it imports out of the bundle.
    define: { __TG_MOCK__: JSON.stringify(mock), __BUILD_ID__: JSON.stringify(buildId) },
    server: { proxy },
    preview: { proxy },
    build: {
      // Nothing is inlined as a data: URI: an inlined paid asset would ship inside a public chunk.
      assetsInlineLimit: 0,
      // A source map carries sourcesContent; production ships none.
      sourcemap: false,
      // dist/.vite/manifest.json is the budget script's chunk graph.
      manifest: true,
      // Q60 R1: all CSS in one stylesheet, linked from index.html. A lazy root's own stylesheet is awaited before its
      // import(), and once it failed the helper never asks for it again, so a retry renders unstyled.
      cssCodeSplit: false,
      // Q60 R1: no <link rel=modulepreload> for any import(). WebKit keeps a failed preload in its memory cache, and
      // every later import() of that URL then fails with no request, past a reload too (WebKit bug 270357). The helper
      // still wraps each import(), so `vite:preloadError` still names every lazy failure (app/boot.ts's recovery).
      modulePreload: { polyfill: false, resolveDependencies: () => [] },
    },
    test: {
      // Q63: the on-disk transform cache keys a module by its own text, so a test's import.meta.glob list goes stale
      // when a file is added (Vitest skips it only for the literal `import.meta.glob(`, not the generic form). Both
      // projects inherit this through `extends: true`; pinned by scripts/test-config.test.ts.
      fsModuleCache: false,
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'node',
            include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
            exclude: ['src/**/*.svelte.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'happy-dom',
            include: ['src/**/*.svelte.test.ts'],
          },
        },
      ],
    },
  };
});
