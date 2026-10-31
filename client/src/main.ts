import { mount } from 'svelte';

import { getTelegram } from './telegram/index.ts';
import { applyInsetVars } from './telegram/viewport.ts';
import App from './ui/App.svelte';

async function boot(): Promise<void> {
  if (__TG_MOCK__) {
    // Dev server and `--mode e2e` only: production defines __TG_MOCK__ false and drops the branch with its chunk.
    const { installMockTransport } = await import('./telegram/dev/mock-transport.ts');
    installMockTransport();
  }
  const tg = getTelegram();
  applyInsetVars(document.documentElement.style);
  tg.expand();
  tg.disableVerticalSwipes();
  tg.setChromeColors('#000000', '#000000');
  const target = document.getElementById('app');
  if (target === null) {
    throw new Error('invariant: #app exists in index.html');
  }
  mount(App, { target });
  // After the tap screen is in the DOM, so Telegram's loading placeholder hides onto it (R1 §2).
  tg.ready();
}

// The entry has no caller to hand the promise to; a rejection is a bug and surfaces as an unhandled rejection.
void boot();
