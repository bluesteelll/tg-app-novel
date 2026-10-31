import { mount } from 'svelte';

import App from './ui/App.svelte';

async function boot(): Promise<void> {
  if (__TG_MOCK__) {
    // Dev server and `--mode e2e` only: production defines __TG_MOCK__ false and drops the branch with its chunk.
    const { installMockTransport } = await import('./telegram/dev/mock-transport.ts');
    installMockTransport();
  }
  const target = document.getElementById('app');
  if (target === null) {
    throw new Error('invariant: #app exists in index.html');
  }
  mount(App, { target });
}

// The entry has no caller to hand the promise to; a rejection is a bug and surfaces as an unhandled rejection.
void boot();
