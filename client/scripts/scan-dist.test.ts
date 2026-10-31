import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { FIXED_SECTIONS, scanFiles } from './scan-dist.ts';
import type { ScanFile, Section } from './scan-dist.ts';
import { loadSections, main } from './scan-dist.ts';
import type { Finding } from './scan-dist.ts';

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

function runCli(
  dist: string,
  script = SCRIPT,
  nodeArgs: readonly string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [...nodeArgs, script, '--dist', dist], { cwd: CLIENT_DIR, encoding: 'utf8' });
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

  test('scan: cli runs through a linked path', () => {
    // Node runs the main module from its realpath while argv[1] keeps the caller's spelling (a junction, macOS's
    // symlinked /tmp): a guard that compares the two spellings skips main() and the leak scan passes silently.
    const link = join(tmp, 'scripts');
    symlinkSync(dirname(SCRIPT), link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const r = runCli(join(tmp, 'no-such-dist'), join(link, 'scan-dist.ts'));
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stderr).toMatch(/does not exist/);
    } finally {
      unlinkSync(link); // the link only: afterEach's recursive delete never meets a way into client/scripts
    }
  });

  test('scan: cli runs through a linked path under preserve-symlinks-main', () => {
    // With the flag (also reachable through NODE_OPTIONS) Node keeps the link's spelling in import.meta.url while the
    // guard canonicalises argv[1]: the guard must canonicalise its own side too, or the leak scan passes silently.
    const link = join(tmp, 'scripts');
    symlinkSync(dirname(SCRIPT), link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const r = runCli(join(tmp, 'no-such-dist'), join(link, 'scan-dist.ts'), ['--preserve-symlinks-main']);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stderr).toMatch(/does not exist/);
    } finally {
      unlinkSync(link); // the link only: afterEach's recursive delete never meets a way into client/scripts
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// L3b: the paid line fingerprints (server/content/build/fingerprints.lines.json) and their per-section non-vacuity,
// read by loadSections from a temporary repository (story tool outputs written by hand).

describe('scan fingerprints', () => {
  const CH1 = { id: 'ch1', entry: 'ch1/main.ink', paid: false, next: 'ch2' };
  const CH2 = { id: 'ch2', entry: 'ch2/main.ink', paid: true, productId: 'chapter:ch2', next: null };
  const TEXT = 'Архив пахнет старой бумагой и пылью.';
  const LINES = { lineIds: ['ch2.archive.r3t6', 'ch2.archive.v5c1'], texts: [TEXT] };
  const USAGE = { chapters: { ch1: { assets: [], knots: {} }, ch2: { assets: [], knots: {} } } };
  let repo = '';

  function write(rel: string, text: string): void {
    const abs = join(repo, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }

  /** A repository as a clean `npm run story` leaves it, minus what `omit` names, with `override` written over it. */
  function setup(override: Readonly<Record<string, string>> = {}, omit: readonly string[] = []): Finding[] {
    const files: Record<string, string> = {
      'story/chapters.json': JSON.stringify([CH1, CH2]),
      'server/content/build/fingerprints.lines.json': JSON.stringify(LINES),
      'server/content/build/usage.json': JSON.stringify(USAGE),
      'server/content/chapters/ch2/story.json': '{"inkVersion":21}',
      ...override,
    };
    mkdirSync(join(repo, 'client'));
    for (const [rel, text] of Object.entries(files).filter(([rel]) => !omit.includes(rel))) {
      write(rel, text);
    }
    return loadSections(join(repo, 'client')).findings;
  }

  function reasons(findings: readonly Finding[]): string[] {
    return findings.flatMap((f) => (f.kind === 'fingerprints' ? [f.reason] : []));
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'scan-fp-'));
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test('scan: paid chapter without line fingerprints fails', () => {
    const findings = setup({}, ['server/content/build/fingerprints.lines.json']);
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'fingerprints', reason: 'lines-missing' }));
  });

  test('scan: paid chapter with empty line-ID section fails', () => {
    // The asset fingerprints (L5's file) do not stand in for the line IDs: each section is checked on its own.
    const findings = setup({
      'server/content/build/fingerprints.assets.json': JSON.stringify({ files: ['bg-archive-0123abcd.avif'] }),
      'server/content/build/fingerprints.lines.json': JSON.stringify({ lineIds: [], texts: [TEXT] }),
    });
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'fingerprints', reason: 'line-ids-empty' }));
  });

  test('scan: paid chapter with empty text section fails', () => {
    const findings = setup({ 'server/content/build/fingerprints.lines.json': JSON.stringify({ ...LINES, texts: [] }) });
    expect(reasons(findings)).toEqual(['texts-empty']);
  });

  test('scan: paid chapter missing from line IDs fails', () => {
    // A fingerprint file written before ch2 became paid holds no ch2 ID.
    const findings = setup({ 'server/content/build/fingerprints.lines.json': JSON.stringify({ lineIds: ['ch3.vault.k2d4'], texts: [TEXT] }) });
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'fingerprints', reason: 'chapter-ids-missing', detail: expect.stringMatching(/^ch2 /) }));
  });

  test('scan: paid chapter without usage fails', () => {
    expect(reasons(setup({}, ['server/content/build/usage.json']))).toEqual(['usage-missing']);
  });

  test('scan: paid chapter without story output fails', () => {
    expect(reasons(setup({}, ['server/content/chapters/ch2/story.json']))).toEqual(['paid-story-missing']);
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo);
    const empty = setup({ 'server/content/chapters/ch2/story.json': '' });
    expect(empty).toEqual([expect.objectContaining({ kind: 'fingerprints', reason: 'paid-story-missing', detail: expect.stringMatching(/empty$/) })]);
  });

  test('scan: unreadable chapters file fails', () => {
    expect(reasons(setup({}, ['story/chapters.json']))).toEqual(['chapters-unreadable']);
    write('story/chapters.json', '[{"id": "ch1",');
    expect(reasons(loadSections(join(repo, 'client')).findings)).toEqual(['chapters-unreadable']);
    write('story/chapters.json', '[]');
    expect(reasons(loadSections(join(repo, 'client')).findings)).toEqual(['chapters-unreadable']);
  });

  test('scan: free-only story needs no line fingerprints', () => {
    const files = ['server/content/build/fingerprints.lines.json', 'server/content/build/usage.json', 'server/content/chapters/ch2/story.json'];
    expect(setup({ 'story/chapters.json': JSON.stringify([{ ...CH1, next: null }]) }, files)).toEqual([]);
    expect(loadSections(join(repo, 'client')).sections).toEqual(FIXED_SECTIONS);
  });

  test('scan: paid line fingerprints are scanned in dist', () => {
    expect(setup()).toEqual([]);
    const { sections } = loadSections(join(repo, 'client'));
    expect(sections.map((s) => `${s.name}(${s.needles.length})`)).toEqual(['compiler(2)', 'dev-canary(4)', 'paid-lines(2)', 'paid-texts(1)']);
    const js = text('assets/index-a.js', `const a=${JSON.stringify(`ch2.archive.v5c1 ${TEXT}`)};export{a};`);
    const findings = scanFiles([INDEX, js], sections);
    expect(findings).toContainEqual({ kind: 'fingerprint', file: 'assets/index-a.js', section: 'paid-lines', needle: 'ch2.archive.v5c1', via: 'plain' });
    expect(findings).toContainEqual({ kind: 'fingerprint', file: 'assets/index-a.js', section: 'paid-texts', needle: TEXT, via: 'plain' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// L5: paid asset files (server/content/build/fingerprints.assets.json, the asset tool's file) by name and by content
// hash, and the per-id non-vacuity of that file, run through main() on a temporary repository.

describe('scan assets', () => {
  const CH1 = { id: 'ch1', entry: 'ch1/main.ink', paid: false, next: 'ch2' };
  const CH2 = { id: 'ch2', entry: 'ch2/main.ink', paid: true, productId: 'chapter:ch2', next: null };
  const LINES = { lineIds: ['ch2.archive.r3t6'], texts: ['Архив пахнет старой бумагой и пылью.'] };
  /** ch2 alone names bg/archive and bgm/mystery: two paid-only assets; bg/cafe is shared, so public. */
  const USAGE = {
    chapters: {
      ch1: { assets: ['bg/cafe'], knots: {} },
      ch2: { assets: ['bg/archive', 'bg/cafe', 'bgm/mystery'], knots: {} },
    },
  };
  /** Incompressible, binary-looking stand-ins for the encoded paid files. */
  const AVIF = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 251);
  const WEBP = Uint8Array.from({ length: 2048 }, (_, i) => (i * 104_729 + 7) % 241);
  const WAV = Uint8Array.from({ length: 1024 }, (_, i) => (i * 31 + 5) % 199);
  const hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  const AVIF_NAME = `bg-archive-${hex(AVIF).slice(0, 8)}.avif`;
  const FILES = [
    { asset: 'bg/archive', name: AVIF_NAME, sha256: hex(AVIF) },
    { asset: 'bg/archive', name: `bg-archive-${hex(WEBP).slice(0, 8)}.webp`, sha256: hex(WEBP) },
    { asset: 'bgm/mystery', name: `bgm-mystery-${hex(WAV).slice(0, 8)}.wav`, sha256: hex(WAV) },
  ];
  let repo = '';

  function put(rel: string, content: string | Uint8Array): void {
    const abs = join(repo, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  /** A repository as `npm run story && npm run assets` leaves it, with `override` written over it, minus `omit`. */
  function setup(override: Readonly<Record<string, string>> = {}, omit: readonly string[] = []): void {
    const files: Record<string, string> = {
      'story/chapters.json': JSON.stringify([CH1, CH2]),
      'server/content/build/fingerprints.lines.json': JSON.stringify(LINES),
      'server/content/build/usage.json': JSON.stringify(USAGE),
      'server/content/build/fingerprints.assets.json': JSON.stringify({ files: FILES }),
      'server/content/chapters/ch2/story.json': '{"inkVersion":21}',
      ...override,
    };
    mkdirSync(join(repo, 'client'), { recursive: true });
    for (const [rel, text] of Object.entries(files).filter(([rel]) => !omit.includes(rel))) {
      put(rel, text);
    }
  }

  /** A dist holding index.html and `files`; main() on it: the exit code and the printed lines. */
  function scanDist(name: string, files: Readonly<Record<string, string | Uint8Array>>): { code: number; lines: string[] } {
    const dist = join(repo, name);
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), new TextDecoder().decode(INDEX.bytes));
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dist, rel)), { recursive: true });
      writeFileSync(join(dist, rel), content);
    }
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
    try {
      return { code: main(['--dist', dist], join(repo, 'client')), lines };
    } finally {
      log.mockRestore();
    }
  }

  function reasons(): string[] {
    return loadSections(join(repo, 'client')).findings.flatMap((f) => (f.kind === 'fingerprints' ? [f.reason] : []));
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'scan-assets-'));
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test('scan: paid asset bytes in dist fail', () => {
    setup();
    expect(reasons()).toEqual([]); // the repository itself is complete
    const paidLine = (via: string, file: string): RegExp => new RegExp(`^scan: paid-asset ${AVIF_NAME.replace('.', '\\.')} in ${file} \\(via ${via}\\)$`);
    // (a) The paid file under its own name.
    const own = scanDist('dist-a', { [`assets/${AVIF_NAME}`]: AVIF });
    expect(own.code, own.lines.join('\n')).toBe(1);
    expect(own.lines).toContainEqual(expect.stringMatching(paidLine('name', `assets/${AVIF_NAME}`)));
    expect(own.lines).toContainEqual(expect.stringMatching(paidLine('hash', `assets/${AVIF_NAME}`)));
    // (b) The same bytes renamed: only the content hash can tell.
    const renamed = scanDist('dist-b', { 'assets/hero-0000.avif': AVIF });
    expect(renamed.code, renamed.lines.join('\n')).toBe(1);
    expect(renamed.lines).toContainEqual(expect.stringMatching(paidLine('hash', 'assets/hero-0000.avif')));
    expect(renamed.lines.filter((l) => l.includes('(via name)'))).toEqual([]);
    // (c) Inlined into a chunk as a base64 data: URI.
    const inlined = `const u="data:image/avif;base64,${Buffer.from(AVIF).toString('base64')}";export{u};`;
    const uri = scanDist('dist-c', { 'assets/index-a.js': inlined });
    expect(uri.code, uri.lines.join('\n')).toBe(1);
    expect(uri.lines).toContainEqual(expect.stringMatching(paidLine('data-uri', 'assets/index-a.js')));
    // (d) No paid bytes, only the paid file's name in a chunk: the paid-asset-files section finds it.
    const named = scanDist('dist-d', { 'assets/index-a.js': `const u="/api/assets/${AVIF_NAME}";export{u};` });
    expect(named.code, named.lines.join('\n')).toBe(1);
    expect(named.lines).toContainEqual(`scan: fingerprint paid-asset-files ${JSON.stringify(AVIF_NAME)} in assets/index-a.js (via plain)`);
    expect(named.lines.filter((l) => l.startsWith('scan: paid-asset '))).toEqual([]);
    // Control: a dist with public art only passes, and every section is counted.
    const clean = scanDist('dist-e', { 'assets/bg-cafe-0a1b2c3d.avif': Uint8Array.from([1, 2, 3]) });
    expect(clean.code, clean.lines.join('\n')).toBe(0);
    expect(clean.lines).toContainEqual(expect.stringMatching(/ sections compiler\(2\) dev-canary\(4\) paid-lines\(1\) paid-texts\(1\) paid-asset-files\(3\)$/));
  });

  test('scan: paid-only asset with empty files section fails', () => {
    setup({ 'server/content/build/fingerprints.assets.json': JSON.stringify({ files: [] }) });
    expect(reasons()).toEqual(['files-empty']);
    expect(scanDist('dist', {}).code).toBe(1);
    rmSync(join(repo, 'server', 'content', 'build', 'fingerprints.assets.json'));
    expect(reasons()).toEqual(['assets-missing']);
    // Present but not this format: never ignored, even while no paid-only asset exists.
    put('server/content/build/fingerprints.assets.json', JSON.stringify({ files: ['bg-archive-0123abcd.avif'] }));
    put('server/content/build/usage.json', JSON.stringify({ chapters: { ch1: { assets: [], knots: {} }, ch2: { assets: [], knots: {} } } }));
    expect(reasons()).toEqual(['assets-missing']);
  });

  test('scan: paid-only asset missing from files fails', () => {
    // Only the audio is listed: the paid-only image has no file entry at all.
    setup({ 'server/content/build/fingerprints.assets.json': JSON.stringify({ files: FILES.slice(2) }) });
    const missing = loadSections(join(repo, 'client')).findings;
    expect(missing).toEqual([expect.objectContaining({ kind: 'fingerprints', reason: 'asset-files-missing', detail: expect.stringMatching(/^bg\/archive has no \.avif, \.webp file /) as string })]);
    // The AVIF without its WebP: that WebP would leak unhashed.
    put('server/content/build/fingerprints.assets.json', JSON.stringify({ files: [FILES[0], FILES[2]] }));
    expect(loadSections(join(repo, 'client')).findings).toEqual([
      expect.objectContaining({ reason: 'asset-files-missing', detail: expect.stringMatching(/^bg\/archive has no \.webp file /) as string }),
    ]);
    // The image without the clip.
    put('server/content/build/fingerprints.assets.json', JSON.stringify({ files: FILES.slice(0, 2) }));
    expect(loadSections(join(repo, 'client')).findings).toEqual([
      expect.objectContaining({ reason: 'asset-files-missing', detail: expect.stringMatching(/^bgm\/mystery has no audio file /) as string }),
    ]);
    expect(scanDist('dist', {}).code).toBe(1);
  });

  test('scan: paid-only world asset with empty files section fails', () => {
    // bg/lamp_room is named only by ch2's world (usage.json worldAssets), never by an ink tag: still paid-only.
    const usage = { chapters: { ch1: { assets: ['bg/cafe'], knots: {} }, ch2: { assets: ['bg/cafe'], knots: {}, worldAssets: ['bg/lamp_room'] } } };
    setup({ 'server/content/build/usage.json': JSON.stringify(usage), 'server/content/build/fingerprints.assets.json': JSON.stringify({ files: [] }) });
    expect(reasons()).toEqual(['files-empty']);
    expect(loadSections(join(repo, 'client')).findings).toEqual([expect.objectContaining({ detail: expect.stringContaining('paid-only bg/lamp_room;') as string })]);
    expect(scanDist('dist', {}).code).toBe(1);
    // The control: the same art in ch1's world too is public.
    put('server/content/build/usage.json', JSON.stringify({ chapters: { ...usage.chapters, ch1: { assets: ['bg/cafe'], knots: {}, worldAssets: ['bg/lamp_room'] } } }));
    expect(reasons()).toEqual([]);
  });

  test('scan: asset fingerprints do not stand in for line ids', () => {
    // A valid asset fingerprint file next to an empty line-ID section: each section is checked on its own.
    setup({ 'server/content/build/fingerprints.lines.json': JSON.stringify({ ...LINES, lineIds: [] }) });
    expect(reasons()).toEqual(['line-ids-empty', 'chapter-ids-missing']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// LW3: the world needles (PUZZLES-PLAN X7, D12): hint IDs and texts of every world, the paid worlds' IDs and texts,
// the paid en values, built by loadSections from the sources of a temporary repository.

describe('scan worlds', () => {
  const CH1 = { id: 'ch1', entry: 'ch1/main.ink', paid: false, next: 'ch2' };
  const CH2 = { id: 'ch2', entry: 'ch2/main.ink', paid: true, productId: 'chapter:ch2', next: null };
  const LINES = { lineIds: ['ch2.archive.r3t6'], texts: ['Архив пахнет старой бумагой и пылью.'] };
  const USAGE = { chapters: { ch1: { assets: [], knots: {} }, ch2: { assets: [], knots: {} } } };
  const HINT_RU = 'Год постройки написан на письме из кабинета.';
  const HINT_EN = 'The year the house was built is on the letter.';
  const HINT_ID = 'ch1.drawer.h001';
  const PAID_TEXT = 'Маяк гаснет каждую ночь ровно в полночь.';
  const PAID_ID = 'ch2.log.p002';
  const PUBLIC_INK = '=== start ===\nДобро пожаловать в усадьбу на холме. #id:ch1.start.a001\n-> END\n';
  let repo = '';

  type Text = { id: string; ru: string };
  /** A world source of one room with one exit, one doc and one code puzzle with `hints`; it decodes. */
  function world(ch: string, body: Text, hints: readonly Text[], extra: Record<string, unknown> = {}): string {
    const t = (owner: string, n: number, ru: string): Text => ({ id: `${ch}.${owner}.t${String(n).padStart(3, '0')}`, ru });
    const exit = { id: 'out', kind: 'exit', rect: [100, 300, 200, 200], label: t('s', 1, 'Выход'), to: { story: 'k' }, lock: null, sfx: null };
    const puzzle = { type: 'code', title: t('drawer', 2, 'Ящик'), prompt: t('drawer', 3, 'Три диска.'), closeup: null, params: { dials: 3 }, maxAttempts: null, giveUp: false, solution: [1, 2, 3], hints };
    return JSON.stringify({
      format: 1,
      items: {},
      docs: { log: { title: t('log', 4, 'Журнал'), body: [body] } },
      puzzles: { drawer: puzzle },
      sections: { s: { start: 'hall', bgm: null, rooms: { hall: { bg: 'hall', title: t('s', 5, 'Холл'), onEnter: [], hotspots: [exit] } } } },
      ...extra,
    });
  }

  function write(rel: string, text: string): void {
    const abs = join(repo, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }

  /** A clean story-tool repository (ch1 free, ch2 paid, no world), `override` written over it; loadSections on it. */
  function setup(override: Readonly<Record<string, string>> = {}): { sections: Section[]; findings: Finding[] } {
    const files: Record<string, string> = {
      'story/chapters.json': JSON.stringify([CH1, CH2]),
      'story/ch1/main.ink': PUBLIC_INK,
      'server/content/build/fingerprints.lines.json': JSON.stringify(LINES),
      'server/content/build/usage.json': JSON.stringify(USAGE),
      'server/content/chapters/ch2/story.json': '{"inkVersion":21}',
      ...override,
    };
    mkdirSync(join(repo, 'client'), { recursive: true });
    for (const [rel, text] of Object.entries(files)) {
      write(rel, text);
    }
    return loadSections(join(repo, 'client'));
  }

  function reasons(findings: readonly Finding[]): string[] {
    return findings.flatMap((f) => (f.kind === 'fingerprints' ? [f.reason] : []));
  }

  function section(sections: readonly Section[], name: string): readonly string[] {
    return sections.find((x) => x.name === name)?.needles ?? [];
  }

  const FREE_HINT_WORLD = { 'story/ch1/world.json': world('ch1', { id: 'ch1.log.b001', ru: 'Короткая записка.' }, [{ id: HINT_ID, ru: HINT_RU }]) };
  const FREE_HINT_EN = { 'story/locales/en/ch1.json': JSON.stringify({ [HINT_ID]: { ru: HINT_RU, en: HINT_EN }, 'ch1.start.a001': { ru: 'Добро пожаловать в усадьбу на холме.', en: 'Welcome to the manor on the hill.' } }) };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'scan-world-'));
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test('scan: hint text in dist fails', () => {
    // A FREE chapter's hint, ru and en of 12+ code points: its world file and en table never count as public (C1).
    const { sections, findings } = setup({ ...FREE_HINT_WORLD, ...FREE_HINT_EN });
    expect(findings).toEqual([]);
    expect(section(sections, 'hint-ids')).toEqual([HINT_ID]);
    expect(section(sections, 'hint-texts')).toEqual([HINT_EN, HINT_RU].sort());
    // The server puzzle shape (no ID) in a chunk, and the hint's ID inside a base64 data: URI.
    const js = text('assets/index-a.js', `const h=${JSON.stringify({ ru: HINT_RU, en: HINT_EN })};const u="data:text/plain;base64,${b64(HINT_ID)}";export{h,u};`);
    const found = scanFiles([INDEX, js], sections);
    expect(found).toContainEqual({ kind: 'fingerprint', file: 'assets/index-a.js', section: 'hint-texts', needle: HINT_RU, via: 'plain' });
    expect(found).toContainEqual({ kind: 'fingerprint', file: 'assets/index-a.js', section: 'hint-texts', needle: HINT_EN, via: 'plain' });
    expect(found).toContainEqual({ kind: 'fingerprint', file: 'assets/index-a.js', section: 'hint-ids', needle: HINT_ID, via: 'data-uri' });
    // The public ink and the public en value are no needle.
    expect(scanFiles([INDEX, text('assets/index-b.js', JSON.stringify(PUBLIC_INK))], sections)).toEqual([]);
  });

  test('scan: hint sources present but no fingerprints fails', () => {
    // A world with hints that does not decode (an unknown key): no hint ID is derived, the raw probe still counts them.
    const broken = world('ch1', { id: 'ch1.log.b001', ru: 'Записка.' }, [{ id: HINT_ID, ru: HINT_RU }], { extra: 1 });
    expect(reasons(setup({ 'story/ch1/world.json': broken }).findings)).toEqual(['world-unreadable', 'hints-empty']);
    // Not JSON at all: unreadable, and nothing to count.
    write('story/ch1/world.json', '{"format": 1,');
    expect(reasons(loadSections(join(repo, 'client')).findings)).toEqual(['world-unreadable']);
    // It decodes and its one long hint text is also public ink: the IDs derive, the texts come out empty.
    write('story/ch1/world.json', world('ch1', { id: 'ch1.log.b001', ru: 'Записка.' }, [{ id: HINT_ID, ru: 'Добро пожаловать в усадьбу на холме.' }]));
    expect(reasons(loadSections(join(repo, 'client')).findings)).toEqual(['hint-texts-empty']);
  });

  test('scan: paid world text in dist fails', () => {
    const { sections, findings } = setup({ 'story/ch2/world.json': world('ch2', { id: PAID_ID, ru: PAID_TEXT }, []) });
    expect(findings).toEqual([]);
    expect(section(sections, 'paid-world-ids')).toContain(PAID_ID);
    expect(section(sections, 'paid-world-texts')).toEqual([PAID_TEXT]); // the other texts are under 12 code points
    expect(section(sections, 'hint-ids')).toEqual([]);
    const js = text('assets/index-a.js', `const p=${JSON.stringify(PAID_TEXT)};const u="data:application/json;base64,${b64(JSON.stringify({ id: PAID_ID }))}";export{p,u};`);
    const found = scanFiles([INDEX, js], sections);
    expect(found).toContainEqual({ kind: 'fingerprint', file: 'assets/index-a.js', section: 'paid-world-texts', needle: PAID_TEXT, via: 'plain' });
    expect(found).toContainEqual({ kind: 'fingerprint', file: 'assets/index-a.js', section: 'paid-world-ids', needle: PAID_ID, via: 'data-uri' });
    // A free world's texts are no needle: only its hints are.
    rmSync(join(repo, 'story', 'ch2'), { recursive: true, force: true });
    const free = setup({ 'story/ch1/world.json': world('ch1', { id: 'ch1.log.b001', ru: PAID_TEXT }, []) }).sections;
    expect(free.filter((x) => x.name.startsWith('paid-world') || x.name.startsWith('hint'))).toEqual([]);
  });

  test('scan: paid world sources present but no fingerprints fails', () => {
    const broken = world('ch2', { id: PAID_ID, ru: PAID_TEXT }, [], { extra: 1 });
    expect(reasons(setup({ 'story/ch2/world.json': broken }).findings)).toEqual(['world-unreadable', 'paid-world-empty']);
    // A paid world that decodes and holds no text at all derives no needle either.
    write('story/ch2/world.json', JSON.stringify({ format: 1, items: {}, docs: {}, puzzles: {}, sections: {} }));
    expect(reasons(loadSections(join(repo, 'client')).findings)).toEqual(['paid-world-empty']);
  });

  test('scan: paid en text in dist fails', () => {
    const paidEn = 'The archive smells of old paper and dust.';
    const shared = 'Welcome to the manor on the hill.';
    const table = { 'ch2.archive.r3t6': { ru: 'Архив пахнет старой бумагой и пылью.', en: paidEn }, 'ch2.archive.v5c1': { ru: 'Да.', en: 'Yes.' }, 'ch2.archive.w7x2': { ru: 'Привет.', en: shared } };
    const { sections, findings } = setup({ 'story/locales/en/ch2.json': JSON.stringify(table), ...FREE_HINT_EN });
    expect(findings).toEqual([]);
    // 'Yes.' is under 12 code points; the shared line is public (ch1's en table) and dropped.
    expect(section(sections, 'paid-en')).toEqual([paidEn]);
    const found = scanFiles([INDEX, text('assets/index-a.js', `const t=${JSON.stringify(paidEn)};export{t};`)], sections);
    expect(found).toContainEqual({ kind: 'fingerprint', file: 'assets/index-a.js', section: 'paid-en', needle: paidEn, via: 'plain' });
  });

  test('scan: a leaked story-gen copy launders no fingerprint', () => {
    // A mis-routed copy of the paid world and the free hints sits in story-gen: the needles come from the sources
    // only, so the copy neither drops them nor stands in for them (D12, critique W1).
    const leak = JSON.stringify({ hint: { ru: HINT_RU, en: HINT_EN }, paid: PAID_TEXT, id: PAID_ID });
    const { sections, findings } = setup({
      ...FREE_HINT_WORLD,
      ...FREE_HINT_EN,
      'story/ch2/world.json': world('ch2', { id: PAID_ID, ru: PAID_TEXT }, []),
      'client/src/story-gen/free/ch1.world.json': leak,
      'client/src/story-gen/free/ch1.en.json': leak,
    });
    expect(findings).toEqual([]);
    const found = scanFiles([INDEX, text('assets/index-a.js', `const l=${leak};export{l};`)], sections).flatMap((f) => (f.kind === 'fingerprint' ? [`${f.section} ${f.needle}`] : []));
    expect(found).toEqual(expect.arrayContaining([`hint-texts ${HINT_RU}`, `hint-texts ${HINT_EN}`, `paid-world-texts ${PAID_TEXT}`, `paid-world-ids ${PAID_ID}`]));
  });
});
