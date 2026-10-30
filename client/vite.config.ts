import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // svelteTesting() only acts under vitest (browser resolve condition, auto-cleanup); builds are unaffected.
  plugins: [svelte(), svelteTesting()],
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
});
