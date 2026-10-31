// Injects the dev mock's bootstrap into index.html as the first classic script of <head>, so it runs before
// telegram-web-app.js, which posts through the queueing proxy the bootstrap defines (R1 §5b). vite.config.ts adds
// the plugin only outside production, and scan-dist's dev-canary fails a production build that would carry it.
// No Node API and no import of 'vite' here: src/telegram/telegram.test.ts type-checks this file in the browser
// program too, and vite's types reference @types/node. The plugin type is structural; vite.config.ts checks it
// against Vite's `Plugin`.
import { bootstrapMock } from '../src/telegram/dev/mock-transport.ts';

/** The one tag the plugin injects (a Vite `HtmlTagDescriptor`). */
export type BootstrapTag = { tag: 'script'; children: string; injectTo: 'head-prepend' };

/** The part of Vite's `Plugin` this plugin fills. */
export type TgDevMockPlugin = { name: string; transformIndexHtml(): BootstrapTag[] };

/** The inline script: the canary global (a scan-dist needle), then the serialised bootstrap applied to `window`. */
export function bootstrapScript(): string {
  return `window.__TG_DEV_MOCK__=true;(${bootstrapMock.toString()})(window)`;
}

/** The dev mock's `transformIndexHtml` (no `type`, so a classic script; `head-prepend`, so before the TWA tag). */
export function tgDevMock(): TgDevMockPlugin {
  return {
    name: 'tg-dev-mock',
    transformIndexHtml: () => [{ tag: 'script', children: bootstrapScript(), injectTo: 'head-prepend' }],
  };
}
