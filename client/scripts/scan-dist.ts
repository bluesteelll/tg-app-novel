// Leak scan of the built client (principle 0): every file of dist/, its UTF-8 text plus every decoded data: URI
// payload, against fingerprint sections. Fails on source maps, the ink compiler, dev canaries and (from L3b/L5)
// paid fingerprints. Every finding is reported; exit 1 iff there is one or dist is missing (the CLI, below).
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeChapterList, decodeLineFingerprints, decodeStoryUsage } from './story/emit.ts';

export type Section = { name: string; needles: readonly string[] };
/** One file of dist/: path relative to dist with '/' separators. */
export type ScanFile = { path: string; bytes: Uint8Array };
/** Why the paid fingerprint sections cannot be trusted to be complete (PROTOTYPE-PLAN.md "Non-vacuous, per section"). */
export type FingerprintReason =
  | 'chapters-unreadable'
  | 'lines-missing'
  | 'line-ids-empty'
  | 'texts-empty'
  | 'chapter-ids-missing'
  | 'usage-missing'
  | 'paid-story-missing';
export type Finding =
  | { kind: 'source-map'; file: string }
  | { kind: 'fingerprint'; file: string; section: string; needle: string; via: 'plain' | 'data-uri' }
  | { kind: 'empty-dist'; reason: string }
  | { kind: 'fingerprints'; reason: FingerprintReason; detail: string };

/** Sections every build is scanned for, whatever the story holds. */
export const FIXED_SECTIONS: readonly Section[] = [
  // inkjs/full only: the runtime never contains these (R4 §2.1, measured).
  { name: 'compiler', needles: ['Compilation failed', 'Recursive INCLUDE detected'] },
  // The Telegram dev mock and debug hooks are compiled out of production builds.
  { name: 'dev-canary', needles: ['__TG_DEV_MOCK__', '__tgMock', '/dev/launch', '__novelDebug'] },
];

/** Nested data: URIs (a data-URI stylesheet holding a data-URI image) are decoded this deep. */
const MAX_DEPTH = 3;
const DATA_URI = /data:([\w!#$&^.+\-/]*(?:;[\w!#$&^.+\-=]*)*),/gi;
const BASE64_PAYLOAD = /^[A-Za-z0-9+/_-]*(?:=|%3d)*/i;
// A URL-encoded payload has no raw quote or whitespace (Vite turns `"` into `'` and spaces into %20).
const URL_PAYLOAD = /^[^"\s`]*/;
const PERCENT_RUN = /(?:%[0-9a-f]{2})+/gi;
const INLINE_SOURCE_MAP = /sourceMappingURL=data:/;

const utf8 = new TextDecoder('utf-8');

/** Percent-decodes every %XX run as UTF-8 bytes; malformed sequences stay as they are. */
function percentDecode(text: string): string {
  return text.replace(PERCENT_RUN, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number.parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16);
    }
    return utf8.decode(bytes);
  });
}

/** The decoded payload of every data: URI in `text` (base64 in both alphabets, or URL-encoded), recursively. */
export function decodeDataUris(text: string, depth = 1): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DATA_URI)) {
    const isBase64 = /;base64$/i.test(m[1] ?? '');
    const rest = text.slice(m.index + m[0].length);
    const payload = (isBase64 ? BASE64_PAYLOAD : URL_PAYLOAD).exec(rest)?.[0] ?? '';
    if (payload === '') {
      continue;
    }
    // Node's base64 decoder accepts the standard and the URL-safe alphabet, with or without padding.
    const decoded = isBase64
      ? Buffer.from(payload.replace(/%3d/gi, '='), 'base64').toString('utf8')
      : percentDecode(payload);
    out.push(decoded);
    if (depth < MAX_DEPTH) {
      out.push(...decodeDataUris(decoded, depth + 1));
    }
  }
  return out;
}

/** Scans every file for every needle of every section; never stops at the first finding. */
export function scanFiles(files: readonly ScanFile[], sections: readonly Section[]): Finding[] {
  for (const section of sections) {
    if (section.needles.some((needle) => needle === '')) {
      // An empty needle matches every file: a fingerprint reader bug, not a finding.
      throw new Error(`invariant: section ${section.name} has an empty needle`);
    }
  }
  const findings: Finding[] = [];
  if (files.length === 0) {
    findings.push({ kind: 'empty-dist', reason: 'no files' });
  } else if (!files.some((f) => f.path === 'index.html')) {
    findings.push({ kind: 'empty-dist', reason: 'no index.html' });
  }
  for (const file of files) {
    const text = utf8.decode(file.bytes);
    if (file.path.endsWith('.map') || INLINE_SOURCE_MAP.test(text)) {
      findings.push({ kind: 'source-map', file: file.path });
    }
    const decoded = decodeDataUris(text);
    for (const section of sections) {
      for (const needle of section.needles) {
        if (text.includes(needle)) {
          findings.push({ kind: 'fingerprint', file: file.path, section: section.name, needle, via: 'plain' });
        } else if (decoded.some((d) => d.includes(needle))) {
          findings.push({ kind: 'fingerprint', file: file.path, section: section.name, needle, via: 'data-uri' });
        }
      }
    }
  }
  return findings;
}

const LINES_FILE = 'server/content/build/fingerprints.lines.json';
const USAGE_FILE = 'server/content/build/usage.json';

/** A repo JSON file, parsed; else why not ('missing', 'not JSON: …'). */
function readRepoJson(repo: string, rel: string): { ok: true; value: unknown } | { ok: false; why: string } {
  const abs = path.join(repo, ...rel.split('/'));
  if (!existsSync(abs)) {
    return { ok: false, why: 'missing' };
  }
  try {
    const text = readFileSync(abs, 'utf8');
    return { ok: true, value: JSON.parse(text.startsWith('﻿') ? text.slice(1) : text) };
  } catch (e) {
    return { ok: false, why: `not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * The sections a build is scanned for: the fixed sections, and while story/chapters.json declares a paid chapter,
 * its line fingerprints (`paid-lines`: every paid line ID; `paid-texts`: paid text samples) from the story tool.
 * Fail closed: every reason the paid sections could be empty or stale is a finding, never a silent pass (an
 * unreadable chapter list included). L5 adds the paid asset files.
 */
export function loadSections(clientRoot: string): { sections: Section[]; findings: Finding[] } {
  const repo = path.resolve(clientRoot, '..');
  const sections: Section[] = [...FIXED_SECTIONS];
  const findings: Finding[] = [];
  const fail = (reason: FingerprintReason, detail: string): void => {
    findings.push({ kind: 'fingerprints', reason, detail });
  };
  const listed = readRepoJson(repo, 'story/chapters.json');
  if (!listed.ok) {
    fail('chapters-unreadable', `story/chapters.json: ${listed.why}`);
    return { sections, findings };
  }
  const chapters = decodeChapterList(listed.value);
  if (!chapters.ok) {
    fail('chapters-unreadable', `story/chapters.json: ${chapters.error.map((i) => `${i.path}: ${i.detail}`).join('; ')}`);
    return { sections, findings };
  }
  const paid = chapters.value.filter((c) => c.paid);
  if (paid.length === 0) {
    return { sections, findings };
  }
  const declared = `paid ${paid.map((c) => c.id).join(', ')} declared`;
  const lines = readRepoJson(repo, LINES_FILE);
  const fp = lines.ok ? decodeLineFingerprints(lines.value) : { ok: false as const, error: [lines.why] };
  if (!fp.ok) {
    fail('lines-missing', `${declared}; ${LINES_FILE}: ${fp.error.join('; ')}`);
  } else {
    sections.push({ name: 'paid-lines', needles: fp.value.lineIds }, { name: 'paid-texts', needles: fp.value.texts });
    if (fp.value.lineIds.length === 0) {
      fail('line-ids-empty', `${declared}; ${LINES_FILE} lineIds is empty`);
    }
    if (fp.value.texts.length === 0) {
      fail('texts-empty', `${declared}; ${LINES_FILE} texts is empty`);
    }
    for (const c of paid.filter((ch) => !fp.value.lineIds.some((id) => id.startsWith(`${ch.id}.`)))) {
      fail('chapter-ids-missing', `${c.id} has no line ID in ${LINES_FILE} (written before it became paid?)`);
    }
  }
  const usage = readRepoJson(repo, USAGE_FILE);
  const decodedUsage = usage.ok ? decodeStoryUsage(usage.value) : { ok: false as const, error: [usage.why] };
  if (!decodedUsage.ok) {
    fail('usage-missing', `${declared}; ${USAGE_FILE}: ${decodedUsage.error.join('; ')}`);
  }
  for (const c of paid) {
    const rel = `server/content/chapters/${c.id}/story.json`;
    const abs = path.join(repo, ...rel.split('/'));
    if (!existsSync(abs) || statSync(abs).size === 0) {
      fail('paid-story-missing', `${rel} is ${existsSync(abs) ? 'empty' : 'missing'}`);
    }
  }
  return { sections, findings };
}

export function formatFinding(f: Finding): string {
  switch (f.kind) {
    case 'source-map':
      return `scan: source-map ${f.file}`;
    case 'fingerprint':
      return `scan: fingerprint ${f.section} ${JSON.stringify(f.needle)} in ${f.file} (via ${f.via})`;
    case 'empty-dist':
      return `scan: empty-dist ${f.reason}`;
    case 'fingerprints':
      return `scan: fingerprints ${f.reason} ${f.detail}`;
    default: {
      const unreachable: never = f;
      return unreachable;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CLI: node scripts/scan-dist.ts [--dist <dir>]   (cwd = client/)

/** Every regular file under `root`, dot-directories included, symlinks not followed; '/' separators. */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
    }
  };
  visit(root, '');
  return out.sort();
}

/** Runs the CLI; returns the exit code. */
export function main(argv: readonly string[], clientRoot: string): number {
  let dist = 'dist';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--dist' && value !== undefined) {
      dist = value;
      i++;
    } else {
      console.error(`scan: unknown argument ${arg ?? ''}; usage: node scripts/scan-dist.ts [--dist <dir>]`);
      return 2;
    }
  }
  const distDir = path.resolve(dist);
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    console.error(`scan: ${distDir} does not exist; run vite build first`);
    return 1;
  }
  const { sections, findings: vacuity } = loadSections(clientRoot);
  const files = walkFiles(distDir).map((rel): ScanFile => ({ path: rel, bytes: readFileSync(path.join(distDir, rel)) }));
  const findings = [...vacuity, ...scanFiles(files, sections)];
  const summary = sections.map((s) => `${s.name}(${s.needles.length})`).join(' ');
  console.log(`scan: ${files.length} files; sections ${summary}`);
  for (const finding of findings) {
    console.log(formatFinding(finding));
  }
  console.log(`scan: ${findings.length} findings`);
  return findings.length > 0 ? 1 : 0;
}

/** A path with its links resolved the way Node resolves the main module; as given when it does not exist. */
function canonical(p: string): string {
  const resolved = path.resolve(p);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function invokedDirectly(moduleUrl: string): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) {
    return false;
  }
  // Node loads the main module from its realpath while argv[1] keeps the caller's spelling (a junction, a symlinked
  // /tmp): only canonical forms compare, or a linked path would skip the scan and exit 0 without a word.
  const self = canonical(fileURLToPath(moduleUrl));
  const invoked = canonical(argv1);
  // Windows paths compare case-insensitively (drive letters arrive as d: or D:).
  return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
}

if (invokedDirectly(import.meta.url)) {
  const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = main(process.argv.slice(2), clientRoot);
}
