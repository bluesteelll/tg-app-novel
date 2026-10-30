// Principle 0 in development (PROTOTYPE-PLAN.md "Paid-content protection", dev server): the Vite dev server, run with
// the real vite.config.ts and client/ as its root, must not serve the paid outputs under server/content/ through
// `/@fs/`. `vite preview` (what the e2e runs) has no `/@fs/` route, so the check lives here.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer, resolveConfig } from 'vite';
import { expect, test } from 'vitest';

const CLIENT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO = path.dirname(CLIENT);
const CONFIG = path.join(CLIENT, 'vite.config.ts');
/** The real config (svelte plugin, config bundling) on a loaded machine: a generous bound instead of a retry. */
const TIMEOUT_MS = 60_000;

/** `dir` is `client/` or below it. */
function insideClient(dir: string): boolean {
  const rel = path.relative(CLIENT, dir);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function field(file: string, key: string): boolean {
  const value = readJson(file);
  return typeof value === 'object' && value !== null && Boolean((value as Record<string, unknown>)[key]);
}

/** Vite's workspace-root markers (searchForWorkspaceRoot) in every ancestor of client/: each widens fs.allow to it. */
function workspaceMarkers(): string[] {
  const found: string[] = [];
  for (let dir = path.dirname(CLIENT); ; dir = path.dirname(dir)) {
    for (const name of ['pnpm-workspace.yaml', 'lerna.json']) {
      if (existsSync(path.join(dir, name))) {
        found.push(path.join(dir, name));
      }
    }
    if (field(path.join(dir, 'package.json'), 'workspaces')) {
      found.push(path.join(dir, 'package.json'));
    }
    for (const name of ['deno.json', 'deno.jsonc']) {
      if (field(path.join(dir, name), 'workspace')) {
        found.push(path.join(dir, name));
      }
    }
    if (path.dirname(dir) === dir) {
      return found;
    }
  }
}

test(
  'dev server refuses /@fs paid path',
  async () => {
    // Overrides only for what a test server does not need (port, HMR, watching, dependency discovery); never server.fs.
    const server = await createServer({
      configFile: CONFIG,
      root: CLIENT,
      logLevel: 'silent',
      server: { port: 0, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    const probe = path.join(REPO, 'server', 'content', `.fs-probe-${randomUUID()}.json`);
    const token = randomUUID();
    try {
      await server.listen();
      mkdirSync(path.dirname(probe), { recursive: true });
      writeFileSync(probe, JSON.stringify({ token }));
      const base = server.resolvedUrls?.local[0];
      if (base === undefined) {
        throw new Error('invariant: a listening dev server has a local URL');
      }
      const fsPath = probe.split(path.sep).join('/').replace(/^\//, '');
      const res = await fetch(new URL(`/@fs/${fsPath}`, base), { signal: AbortSignal.timeout(10_000) });
      const body = await res.text();
      expect(res.status, `${res.status} ${body.slice(0, 300)}`).toBe(403);
      expect(body).not.toContain(token);
    } finally {
      rmSync(probe, { force: true });
      await server.close();
    }
  },
  TIMEOUT_MS,
);

test(
  'dev config: fs.allow stays inside client/',
  async () => {
    const config = await resolveConfig({ configFile: CONFIG, root: CLIENT, logLevel: 'silent' }, 'serve');
    const allow = config.server.fs.allow;
    expect(config.server.fs.strict).toBe(true);
    expect(allow.length).toBeGreaterThan(0);
    expect(allow.filter((dir) => !insideClient(dir)), `server.fs.allow resolved to ${JSON.stringify(allow)}`).toEqual([]);
    expect(workspaceMarkers(), 'a workspace marker above client/ widens server.fs.allow to its directory').toEqual([]);
  },
  TIMEOUT_MS,
);
