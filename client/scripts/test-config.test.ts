// Q63: Vitest's fsModuleCache keys a module's cached transform by the module's own text, so a test whose
// import.meta.glob lists files keeps its old list after a file is added, and a glob-driven check can pass without ever
// seeing the new file. The test gate therefore transforms every module afresh. The config is resolved the way the gate
// resolves it: the `test` script's own CLI options and Vitest's own config discovery from client/ (npm runs the script
// there), projects included, so a second config file, a script flag or a project that stops inheriting turns this red.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { parseCLI, resolveConfig } from 'vitest/node';
import type { ResolvedConfig } from 'vitest/node';

const CLIENT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
/** The real config (svelte plugin, config bundling) on a loaded machine: a generous bound instead of a retry. */
const TIMEOUT_MS = 60_000;

/** `scripts.test` of client/package.json, unparsed. */
function testScript(): unknown {
  const pkg: unknown = JSON.parse(readFileSync(path.join(CLIENT, 'package.json'), 'utf8'));
  if (typeof pkg !== 'object' || pkg === null || !('scripts' in pkg)) {
    return undefined;
  }
  const { scripts } = pkg;
  if (typeof scripts !== 'object' || scripts === null || !('test' in scripts)) {
    return undefined;
  }
  return scripts.test;
}

test(
  'test gate: no project reuses a cached module transform',
  async () => {
    const script = testScript();
    expect(typeof script, 'client/package.json scripts.test').toBe('string');
    if (typeof script !== 'string') {
      return;
    }
    const { options } = parseCLI(script);
    // The gate's working directory is client/: a relative --root resolves there, and --config against that root.
    const root = path.resolve(CLIENT, options.root ?? '.');
    const vite = await resolveConfig({ ...options, root }, { logLevel: 'silent' });
    // resolveConfig replaces `test` with Vitest's resolved config; Vite's own type still names the inline one.
    const resolved = vite.test as unknown as ResolvedConfig;
    const seen = {
      '(root)': resolved.fsModuleCache,
      ...Object.fromEntries(
        resolved.resolvedProjects.map((entry) => [entry.projectConfig.name, entry.projectConfig.fsModuleCache]),
      ),
    };
    expect(seen, `resolved from ${vite.configFile ?? 'no config file'}`).toEqual({
      '(root)': false,
      unit: false,
      dom: false,
    });
  },
  TIMEOUT_MS,
);
