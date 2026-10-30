import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  build: {
    // Nothing is inlined as a data: URI: an inlined paid asset would ship inside a public chunk.
    assetsInlineLimit: 0,
    // A source map carries sourcesContent; production ships none.
    sourcemap: false,
    // dist/.vite/manifest.json is the budget script's chunk graph.
    manifest: true,
  },
});
