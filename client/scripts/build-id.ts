// The client build's id (LBI D1): a hash of the build's inputs, computed once per `vite build` (vite.config.ts) and
// used both for the `__BUILD_ID__` define the bundle compiles in and for the `build-id.txt` written beside it, which
// the server reads from STATIC_DIR (server/src/api/static_files.rs) and names on every `/api` answer. One value per
// build, so the page and the file cannot differ. Inputs, not outputs: the bundle must know its id at compile time,
// and an output hash would be circular (the entry's name hashes its own code). An input that never reaches the bundle
// (a fixture) still moves the id: one needless reload per deploy, never a missed skew. Not a secret, not a timestamp
// (two builds of one tree give one id), nothing about paid content: server/content/ is not an input (principle 0).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

/** The file the build writes at its output root; the server's `BUILD_ID_FILE`. */
export const BUILD_ID_FILE = 'build-id.txt';

/** Single files at the client root that shape the bundle; a missing one is skipped. */
const ROOT_FILES: readonly string[] = ['index.html', 'package-lock.json', 'vite.config.ts', 'svelte.config.js', 'tsconfig.json'];
/**
 * Trees at the client root whose every file is an input: the sources (the story tool's `src/story-gen/` included),
 * the dev mock's plugin and the public files (the asset tool's `public/assets/` included). A missing tree is skipped.
 */
const TREES: readonly string[] = ['src', 'vite-plugins', 'public'];
/** Tests never reach the bundle (`*.test.ts` covers `*.svelte.test.ts`). */
const TEST_FILE = /\.test\.ts$/;

/** Every file under `rel` (a `/`-relative path under `root`), as `/`-relative paths, tests left out. */
function filesUnder(root: string, rel: string, out: string[]): void {
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      filesUnder(root, child, out);
    } else if (entry.isFile() && !TEST_FILE.test(child)) {
      out.push(child);
    }
  }
}

/**
 * The id of a build of `clientRoot` in `mode`: the first 16 lowercase hex digits of a sha256 over the inputs in
 * code-unit order of their `/`-relative paths, each as `path NUL byteLength NUL bytes`, then `mode` (so `dist` and
 * `dist-e2e` differ). Throws only on an input it cannot read: a broken checkout, a bug of the build.
 */
export function buildIdOf(clientRoot: string, mode: string): string {
  const files = ROOT_FILES.filter((f) => existsSync(path.join(clientRoot, f)));
  for (const tree of TREES) {
    if (existsSync(path.join(clientRoot, tree))) {
      filesUnder(clientRoot, tree, files);
    }
  }
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const hash = createHash('sha256');
  for (const rel of files) {
    const bytes = readFileSync(path.join(clientRoot, rel));
    hash.update(rel);
    hash.update('\0');
    hash.update(String(bytes.byteLength));
    hash.update('\0');
    hash.update(bytes);
  }
  hash.update(mode);
  return hash.digest('hex').slice(0, 16);
}

/**
 * Writes `<output dir>/build-id.txt` = `${id}\n` once the bundle is written. Not `emitFile`: the Vite manifest, which
 * the budget script reads as the chunk graph, stays as it was.
 */
export function buildIdFile(id: string): Plugin {
  return {
    name: 'novel-build-id',
    apply: 'build',
    writeBundle(options) {
      const dir = options.dir ?? (options.file === undefined ? undefined : path.dirname(options.file));
      if (dir === undefined) {
        throw new Error('invariant: a vite build writes to a directory');
      }
      writeFileSync(path.join(dir, BUILD_ID_FILE), `${id}\n`);
    },
  };
}
