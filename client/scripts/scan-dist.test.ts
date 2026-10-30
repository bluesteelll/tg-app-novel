import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { FIXED_SECTIONS, scanFiles } from './scan-dist.ts';
import type { ScanFile, Section } from './scan-dist.ts';

const enc = new TextEncoder();

function text(path: string, content: string): ScanFile {
  return { path, bytes: enc.encode(content) };
}

const INDEX = text(
  'index.html',
  '<!doctype html><html><head><script src="https://telegram.org/js/telegram-web-app.js?64"></script>' +
    '<script type="module" src="/assets/index-a.js"></script></head><body><div id="app"></div></body></html>',
);

/** A paid line-ID section like the one L3b reads from fingerprints.lines.json. */
const PAID: Section = { name: 'paid-lines', needles: ['ch2_k1_0001', 'ch2_k1_0002', 'ch2_k1_0003'] };
const SECTIONS: readonly Section[] = [...FIXED_SECTIONS, PAID];

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

/** Every byte as %XX, so no needle survives in the raw text. */
function percentAll(s: string): string {
  return [...Buffer.from(s, 'utf8')].map((b) => `%${b.toString(16).padStart(2, '0')}`).join('');
}

function rawIncludes(file: ScanFile, needle: string): boolean {
  return new TextDecoder().decode(file.bytes).includes(needle);
}

describe('scan files', () => {
  test('scan: base64 data uri with a paid id fails', () => {
    // Standard alphabet (Vite's inlining form) and the URL-safe alphabet without padding.
    const std = `{"id":"ch2_k1_0001",">>>?":"???"}`;
    const urlSafe = b64(std).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(urlSafe).toMatch(/[-_]/); // the fixture really exercises the URL-safe alphabet
    for (const payload of [b64(std), urlSafe]) {
      const js = text('assets/index-a.js', `const u="data:application/json;base64,${payload}";export{u};`);
      expect(rawIncludes(js, 'ch2_k1_0001')).toBe(false); // only decoding can find it
      expect(scanFiles([INDEX, js], SECTIONS)).toContainEqual({
        kind: 'fingerprint',
        file: 'assets/index-a.js',
        section: 'paid-lines',
        needle: 'ch2_k1_0001',
        via: 'data-uri',
      });
    }
  });

  test('scan: percent-encoded data uri is decoded', () => {
    // Vite inlines SVG as a URL-encoded (not base64) data URI.
    const svg = text('assets/a.js', `const s="data:image/svg+xml,${percentAll('<svg><text>ch2_k1_0002</text></svg>')}";`);
    expect(rawIncludes(svg, 'ch2_k1_0002')).toBe(false);
    expect(scanFiles([INDEX, svg], SECTIONS)).toContainEqual({
      kind: 'fingerprint',
      file: 'assets/a.js',
      section: 'paid-lines',
      needle: 'ch2_k1_0002',
      via: 'data-uri',
    });
    // A data-URI stylesheet carrying a base64 data-URI image: decoded recursively.
    const inner = `data:image/svg+xml;base64,${b64('<svg><text>ch2_k1_0003</text></svg>')}`;
    const css = text('assets/b.css', `@import url("data:text/css,${percentAll(`a{background:url(${inner})}`)}");`);
    expect(rawIncludes(css, 'ch2_k1_0003')).toBe(false);
    expect(scanFiles([INDEX, css], SECTIONS)).toContainEqual({
      kind: 'fingerprint',
      file: 'assets/b.css',
      section: 'paid-lines',
      needle: 'ch2_k1_0003',
      via: 'data-uri',
    });
  });

  test('scan: map file fails', () => {
    const map = text('assets/index-a.js.map', '{"version":3,"sources":[],"mappings":""}');
    expect(scanFiles([INDEX, map], SECTIONS)).toContainEqual({ kind: 'source-map', file: 'assets/index-a.js.map' });
  });

  test('scan: inline source map fails', () => {
    const js = text(
      'assets/index-a.js',
      `export{};\n//# sourceMappingURL=data:application/json;base64,${b64('{"version":3,"sourcesContent":["x"]}')}\n`,
    );
    expect(scanFiles([INDEX, js], SECTIONS)).toContainEqual({ kind: 'source-map', file: 'assets/index-a.js' });
  });

  for (const needle of ['Compilation failed', 'Recursive INCLUDE detected']) {
    test(`scan: compiler string ${needle} fails`, () => {
      const js = text('assets/index-a.js', `throw new Error(${JSON.stringify(needle)});`);
      expect(scanFiles([INDEX, js], SECTIONS)).toContainEqual({
        kind: 'fingerprint',
        file: 'assets/index-a.js',
        section: 'compiler',
        needle,
        via: 'plain',
      });
    });
  }

  for (const needle of ['__TG_DEV_MOCK__', '__tgMock', '/dev/launch', '__novelDebug']) {
    test(`scan: dev canary ${needle} fails`, () => {
      const js = text('assets/index-a.js', `console.info(${JSON.stringify(needle)});`);
      expect(scanFiles([INDEX, js], SECTIONS)).toContainEqual({
        kind: 'fingerprint',
        file: 'assets/index-a.js',
        section: 'dev-canary',
        needle,
        via: 'plain',
      });
    });
  }

  test('scan: empty dist fails', () => {
    expect(scanFiles([], SECTIONS)).toContainEqual({ kind: 'empty-dist', reason: 'no files' });
    const noIndex = scanFiles([text('assets/index-a.js', 'export{};')], SECTIONS);
    expect(noIndex).toContainEqual({ kind: 'empty-dist', reason: 'no index.html' });
  });

  test('scan: clean dist passes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
    const files = [
      INDEX,
      text('.vite/manifest.json', '{"index.html":{"file":"assets/index-a.js","isEntry":true}}'),
      text(
        'assets/index-a.js',
        `const i="data:image/png;base64,${png}";const s="data:image/svg+xml,%3csvg%3e%3c/svg%3e";` +
          'if(u.startsWith("data:"))f();export{i,s};\n',
      ),
      text('assets/index-c.css', 'body{margin:0;background:#000}'),
    ];
    expect(scanFiles(files, SECTIONS)).toEqual([]);
  });

  test('scan: every finding is reported', () => {
    const a = text('assets/index-a.js', 'console.info("__TG_DEV_MOCK__");throw new Error("Compilation failed");');
    const b = text('assets/index-a.js.map', '{"version":3}');
    const findings = scanFiles([INDEX, a, b], SECTIONS);
    expect(findings).toHaveLength(3);
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'fingerprint', needle: '__TG_DEV_MOCK__' }));
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'fingerprint', needle: 'Compilation failed' }));
    expect(findings).toContainEqual({ kind: 'source-map', file: 'assets/index-a.js.map' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CLI: spawned the way `npm run build` runs it. Only exit-1 cases: they stay red whatever sections later lanes
// add (L3b's paid sections can only add findings); the exit-0 proof is the real `npm run build`.

const CLIENT_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./scan-dist.ts', import.meta.url));

function runCli(dist: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, '--dist', dist], { cwd: CLIENT_DIR, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('scan cli', () => {
  let tmp = '';
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'scan-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('scan: cli exits 1 on a dirty dist', () => {
    mkdirSync(join(tmp, 'assets'));
    writeFileSync(join(tmp, 'index.html'), new TextDecoder().decode(INDEX.bytes));
    writeFileSync(join(tmp, 'assets', 'index-a.js'), 'console.info("__TG_DEV_MOCK__");\n');
    const r = runCli(tmp);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^scan: fingerprint dev-canary "__TG_DEV_MOCK__" in assets\/index-a\.js/m);
    expect(r.stdout).toMatch(/^scan: [1-9]\d* findings$/m);
  });

  test('scan: cli exits 1 on a missing dist', () => {
    const r = runCli(join(tmp, 'no-such-dist'));
    expect(r.status, r.stdout + r.stderr).toBe(1);
  });
});
