// The e2e harness (PROTOTYPE-PLAN "e2e"): Chromium at 375x812 with touch, against `vite preview` of the
// `--mode e2e` build (dist-e2e, the dev mock compiled in) and server-dev, both on the lane's ports and never reused:
// a port already answering fails the run before any test ("is already used"), so no test runs against a foreign
// server. Vacuous-green guards: forbidOnly, no retries, and helpers.ts's reporter fails a run with a skipped test.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

/** server-dev's port rule (server/dev/src/main.rs `dev_addr`), as vite.config.ts reads DEV_API_PORT. */
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

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(E2E_DIR, '..');
const REPO_DIR = path.resolve(CLIENT_DIR, '..');
const API_PORT = envPort('DEV_API_PORT', 8787);
const WEB_PORT = envPort('DEV_WEB_PORT', 4173);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // client/test-results/ is git-ignored; the default e2e/test-results/ is not.
  outputDir: '../test-results',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['./helpers.ts']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 375, height: 812 },
    hasTouch: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      // SERVER_DEV_CMD names a prebuilt binary where a lane may not run cargo (RULINGS 36); a full command line.
      command: process.env['SERVER_DEV_CMD'] ?? 'cargo run -p server-dev --locked',
      cwd: REPO_DIR,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { DEV_API_PORT: String(API_PORT) },
      reuseExistingServer: false,
      // A cold `cargo run` builds first.
      timeout: 600_000,
      stdout: 'pipe',
    },
    {
      command: `vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: CLIENT_DIR,
      url: `http://127.0.0.1:${WEB_PORT}/`,
      // preview.proxy forwards /api/, /dev/ and /telegram/ to this server-dev.
      env: { DEV_API_PORT: String(API_PORT) },
      reuseExistingServer: false,
    },
  ],
});
