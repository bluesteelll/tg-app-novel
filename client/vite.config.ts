import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

import { tgDevMock } from './vite-plugins/tg-dev-mock.ts';

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

export default defineConfig(({ mode }) => {
  // K25: the dev mock exists in every mode but production (the dev server, vitest, `--mode e2e`).
  const mock = mode !== 'production';
  // K27: the page and the API share one origin; the dev and preview servers forward to server-dev.
  const api = `http://127.0.0.1:${envPort('DEV_API_PORT', 8787)}`;
  const proxy = { '/api/': api, '/dev/': api, '/telegram/': api };
  return {
    // svelteTesting() only acts under vitest (browser resolve condition, auto-cleanup); builds are unaffected.
    plugins: [svelte(), svelteTesting(), ...(mock ? [tgDevMock()] : [])],
    // Production compiles `if (__TG_MOCK__)` and the mock chunk it imports out of the bundle.
    define: { __TG_MOCK__: JSON.stringify(mock) },
    server: { proxy },
    preview: { proxy },
    build: {
      // Nothing is inlined as a data: URI: an inlined paid asset would ship inside a public chunk.
      assetsInlineLimit: 0,
      // A source map carries sourcesContent; production ships none.
      sourcemap: false,
      // dist/.vite/manifest.json is the budget script's chunk graph.
      manifest: true,
    },
    test: {
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
