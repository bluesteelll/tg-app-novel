// The build id (LBI D1): one value per build, from the build's inputs only, compiled in by vite.config.ts and written
// beside the bundle. The id is pinned against its documented format on a fixed tree, so a timestamp, a random value
// or an input outside the list cannot pass for it.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveConfig } from 'vite';
import type { Plugin, Rolldown } from 'vite';
import { afterEach, expect, test } from 'vitest';

import { BUILD_ID_FILE, buildIdFile, buildIdOf } from './build-id.ts';

const CLIENT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONFIG = path.join(CLIENT, 'vite.config.ts');
/** The real config (svelte plugin, config bundling, a hash of the whole client) on a loaded machine. */
const TIMEOUT_MS = 60_000;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh client tree holding `files` (`/`-relative path -> text). */
function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'build-id-'));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    write(root, rel, text);
  }
  return root;
}

function write(root: string, rel: string, text: string): void {
  const file = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** The documented id of `inputs` (already in path order) in `mode`, computed here independently of build-id.ts. */
function documented(inputs: ReadonlyArray<readonly [string, string]>, mode: string): string {
  const hash = createHash('sha256');
  for (const [rel, text] of inputs) {
    const bytes = Buffer.from(text, 'utf8');
    hash.update(`${rel}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  hash.update(mode);
  return hash.digest('hex').slice(0, 16);
}

const FILES = {
  'index.html': '<!doctype html>',
  'vite.config.ts': 'export default {};',
  'src/main.ts': "import './a.ts';",
  'src/a.ts': 'export const a = 1;',
  'src/a.test.ts': "test('a', () => {});",
  'src/ui/B.svelte.test.ts': "test('b', () => {});",
  'public/x.txt': 'x',
  'scripts/tool.ts': 'not an input',
  'README.md': 'not an input',
} as const;

test('build id: the same inputs give the same id', () => {
  const root = tree(FILES);
  const first = buildIdOf(root, 'production');
  expect(first).toMatch(/^[0-9a-f]{16}$/);
  expect(buildIdOf(root, 'production')).toBe(first);
  // The format, on a fixed tree: the inputs in code-unit path order, tests and files outside the list left out.
  expect(first).toBe(
    documented(
      [
        ['index.html', FILES['index.html']],
        ['public/x.txt', FILES['public/x.txt']],
        ['src/a.ts', FILES['src/a.ts']],
        ['src/main.ts', FILES['src/main.ts']],
        ['vite.config.ts', FILES['vite.config.ts']],
      ],
      'production',
    ),
  );
});

test('build id: a source change moves it, a test file does not', () => {
  const root = tree(FILES);
  const base = buildIdOf(root, 'production');
  write(root, 'src/a.test.ts', "test('a again', () => {});");
  write(root, 'src/ui/B.svelte.test.ts', "test('b again', () => {});");
  write(root, 'scripts/tool.ts', 'still not an input');
  expect(buildIdOf(root, 'production'), 'a test file or a file outside the inputs').toBe(base);
  expect(buildIdOf(root, 'e2e'), 'the mode').not.toBe(base);
  write(root, 'src/a.ts', 'export const a = 2;');
  const changed = buildIdOf(root, 'production');
  expect(changed, 'a source file').not.toBe(base);
  write(root, 'public/y.txt', 'y');
  expect(buildIdOf(root, 'production'), 'a new public file').not.toBe(changed);
  // A tree without public/ (or any other listed input) is hashed from what it has.
  rmSync(path.join(root, 'public'), { recursive: true });
  expect(buildIdOf(root, 'production')).toMatch(/^[0-9a-f]{16}$/);
});

/** The plugin's `writeBundle`, called as the build calls it for an output directory. */
async function runWriteBundle(plugin: Plugin, dir: string): Promise<void> {
  const hook = plugin.writeBundle;
  const fn = typeof hook === 'function' ? hook : hook?.handler;
  if (fn === undefined) {
    throw new Error('the build id plugin has no writeBundle');
  }
  // The hook reads only `dir` of the output options and no plugin context: the rest of Rolldown's types stay unset.
  await fn.call({} as Rolldown.PluginContext, { dir } as Rolldown.NormalizedOutputOptions, {});
}

test(
  'build id: vite.config.ts defines and writes one id',
  async () => {
    const built = await resolveConfig({ configFile: CONFIG, root: CLIENT, logLevel: 'silent' }, 'build', 'production');
    const id = buildIdOf(CLIENT, 'production');
    expect(built.define?.['__BUILD_ID__']).toBe(JSON.stringify(id));
    const plugin = built.plugins.find((p) => p.name === 'novel-build-id');
    expect(plugin, 'the build id plugin in a build').toBeDefined();
    const out = tree({});
    if (plugin !== undefined) {
      await runWriteBundle(plugin, out);
    }
    expect(readFileSync(path.join(out, BUILD_ID_FILE), 'utf8')).toBe(`${id}\n`);
    // The plugin writes whatever id it was made with: the config's one id is what reaches both places.
    const other = tree({});
    await runWriteBundle(buildIdFile('ffffffffffffffff'), other);
    expect(readFileSync(path.join(other, BUILD_ID_FILE), 'utf8')).toBe('ffffffffffffffff\n');
    // The dev server, vitest and `vite preview` have no id: such a page never reports a skew.
    const served = await resolveConfig({ configFile: CONFIG, root: CLIENT, logLevel: 'silent' }, 'serve');
    expect(served.define?.['__BUILD_ID__']).toBe('null');
    expect(served.plugins.some((p) => p.name === 'novel-build-id')).toBe(false);
  },
  TIMEOUT_MS,
);
