// Leak scan of the built client (principle 0): every file of dist/, its UTF-8 text plus every decoded data: URI
// payload, against fingerprint sections. Fails on source maps, the ink compiler, dev canaries and (from L3b/L5)
// paid fingerprints: paid line IDs and texts, paid asset file names, and paid asset bytes by content hash (a renamed
// copy, or one inlined as a base64 data: URI). Every finding is reported; exit 1 iff there is one or dist is missing.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ChapterListEntry } from '../src/story/catalog.ts';
import { decodeAssetFingerprints } from './assets/manifest.ts';
import type { AssetFingerprint } from './assets/manifest.ts';
import { decodeChapterList, decodeLineFingerprints, decodeStoryUsage } from './story/emit.ts';
import type { StoryUsage } from './story/emit.ts';

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
  | 'paid-story-missing'
  | 'assets-missing'
  | 'files-empty'
  | 'asset-files-missing';
export type Finding =
  | { kind: 'source-map'; file: string }
  | { kind: 'fingerprint'; file: string; section: string; needle: string; via: 'plain' | 'data-uri' }
  | { kind: 'empty-dist'; reason: string }
  | { kind: 'fingerprints'; reason: FingerprintReason; detail: string }
  /** A paid asset file in dist: under its own name, as the same bytes under another name, or inlined as a data: URI. */
  | { kind: 'paid-asset'; file: string; name: string; via: 'name' | 'hash' | 'data-uri' };

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

/** One decoded data: URI payload: its text, and its bytes when it was base64 (a binary file can only be base64). */
type DataUri = { text: string; bytes: Uint8Array | null };

function dataUris(text: string, depth: number): DataUri[] {
  const out: DataUri[] = [];
  for (const m of text.matchAll(DATA_URI)) {
    const isBase64 = /;base64$/i.test(m[1] ?? '');
    const rest = text.slice(m.index + m[0].length);
    const payload = (isBase64 ? BASE64_PAYLOAD : URL_PAYLOAD).exec(rest)?.[0] ?? '';
    if (payload === '') {
      continue;
    }
    // Node's base64 decoder accepts the standard and the URL-safe alphabet, with or without padding.
    const bytes = isBase64 ? Buffer.from(payload.replace(/%3d/gi, '='), 'base64') : null;
    const decoded = bytes !== null ? bytes.toString('utf8') : percentDecode(payload);
    out.push({ text: decoded, bytes });
    if (depth < MAX_DEPTH) {
      out.push(...dataUris(decoded, depth + 1));
    }
  }
  return out;
}

/** The decoded payload of every data: URI in `text` (base64 in both alphabets, or URL-encoded), recursively. */
export function decodeDataUris(text: string, depth = 1): string[] {
  return dataUris(text, depth).map((d) => d.text);
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Every dist file that is a paid asset file: by its basename, by the sha256 of its bytes (the same file renamed), or
 * by the sha256 of a base64 data: URI payload inside it (inlined, up to the data-URI depth). A file can match more
 * than one way; each way is a finding.
 */
export function scanPaidFiles(files: readonly ScanFile[], paid: readonly AssetFingerprint[]): Finding[] {
  if (paid.length === 0) {
    return [];
  }
  const byName = new Map(paid.map((f) => [f.name, f.name]));
  const byHash = new Map(paid.map((f) => [f.sha256, f.name]));
  const findings: Finding[] = [];
  for (const file of files) {
    const named = byName.get(file.path.slice(file.path.lastIndexOf('/') + 1));
    if (named !== undefined) {
      findings.push({ kind: 'paid-asset', file: file.path, name: named, via: 'name' });
    }
    const hashed = byHash.get(sha256(file.bytes));
    if (hashed !== undefined) {
      findings.push({ kind: 'paid-asset', file: file.path, name: hashed, via: 'hash' });
    }
    for (const uri of dataUris(utf8.decode(file.bytes), 1)) {
      const inlined = uri.bytes === null ? undefined : byHash.get(sha256(uri.bytes));
      if (inlined !== undefined) {
        findings.push({ kind: 'paid-asset', file: file.path, name: inlined, via: 'data-uri' });
      }
    }
  }
  return findings;
}

const LINES_FILE = 'server/content/build/fingerprints.lines.json';
const USAGE_FILE = 'server/content/build/usage.json';
const ASSETS_FILE = 'server/content/build/fingerprints.assets.json';
const AUDIO_ID = /^(?:bgm|sfx)\//;

/**
 * Asset ids a paid chapter names and no free chapter names, from the story tool's usage.json and the chapter list:
 * computed here, never through the asset tool's own tiering or files, so a tiering fault there cannot also switch
 * this check off (PROTOTYPE-PLAN "Paid-content protection").
 */
function paidOnlyAssets(usage: StoryUsage, chapters: readonly ChapterListEntry[]): string[] {
  const named = (paid: boolean): Set<string> =>
    new Set(chapters.filter((c) => c.paid === paid).flatMap((c) => usage.chapters[c.id]?.assets ?? []));
  const free = named(false);
  return [...named(true)].filter((id) => !free.has(id)).sort();
}

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
 * unreadable chapter list included). L5: while a paid-only asset exists (or the asset fingerprint file is present),
 * `fingerprints.assets.json` must decode, list files, and cover every paid-only asset's files (an image: its AVIF and
 * WebP); its names become the `paid-asset-files` section and its entries `paidFiles`, for `scanPaidFiles`.
 */
export function loadSections(clientRoot: string): { sections: Section[]; findings: Finding[]; paidFiles: AssetFingerprint[] } {
  const repo = path.resolve(clientRoot, '..');
  const sections: Section[] = [...FIXED_SECTIONS];
  const findings: Finding[] = [];
  const paidFiles: AssetFingerprint[] = [];
  const fail = (reason: FingerprintReason, detail: string): void => {
    findings.push({ kind: 'fingerprints', reason, detail });
  };
  const listed = readRepoJson(repo, 'story/chapters.json');
  if (!listed.ok) {
    fail('chapters-unreadable', `story/chapters.json: ${listed.why}`);
    return { sections, findings, paidFiles };
  }
  const chapters = decodeChapterList(listed.value);
  if (!chapters.ok) {
    fail('chapters-unreadable', `story/chapters.json: ${chapters.error.map((i) => `${i.path}: ${i.detail}`).join('; ')}`);
    return { sections, findings, paidFiles };
  }
  const paid = chapters.value.filter((c) => c.paid);
  if (paid.length === 0) {
    return { sections, findings, paidFiles };
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
  const paidOnly = decodedUsage.ok ? paidOnlyAssets(decodedUsage.value, chapters.value) : [];
  const assets = readRepoJson(repo, ASSETS_FILE);
  // Read while it is needed, or whenever it is there: a present file that does not decode is never ignored.
  if (paidOnly.length > 0 || assets.ok || assets.why !== 'missing') {
    const owed = paidOnly.length > 0 ? `paid-only ${paidOnly.join(', ')}; ` : '';
    const fpa = assets.ok ? decodeAssetFingerprints(assets.value) : { ok: false as const, error: [assets.why] };
    if (!fpa.ok) {
      fail('assets-missing', `${owed}${ASSETS_FILE}: ${fpa.error.join('; ')}`);
    } else {
      paidFiles.push(...fpa.value.files);
      if (paidFiles.length > 0) {
        sections.push({ name: 'paid-asset-files', needles: paidFiles.map((f) => f.name) });
      }
      if (paidOnly.length > 0 && paidFiles.length === 0) {
        fail('files-empty', `${owed}${ASSETS_FILE} files is empty`);
      } else {
        for (const id of paidOnly) {
          const exts = paidFiles.filter((f) => f.asset === id).map((f) => f.name.slice(f.name.lastIndexOf('.')));
          const owedExts = AUDIO_ID.test(id) ? (exts.length > 0 ? [] : ['audio']) : ['.avif', '.webp'].filter((e) => !exts.includes(e));
          if (owedExts.length > 0) {
            fail('asset-files-missing', `${id} has no ${owedExts.join(', ')} file in ${ASSETS_FILE} (written before it became paid-only?)`);
          }
        }
      }
    }
  }
  return { sections, findings, paidFiles };
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
    case 'paid-asset':
      return `scan: paid-asset ${f.name} in ${f.file} (via ${f.via})`;
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
  const { sections, findings: vacuity, paidFiles } = loadSections(clientRoot);
  const files = walkFiles(distDir).map((rel): ScanFile => ({ path: rel, bytes: readFileSync(path.join(distDir, rel)) }));
  const findings = [...vacuity, ...scanFiles(files, sections), ...scanPaidFiles(files, paidFiles)];
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
