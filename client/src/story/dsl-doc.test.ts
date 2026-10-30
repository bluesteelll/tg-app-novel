// The two-way contract of docs/STAGING-DSL.md (its "Two-way check" bullet): the doc and the tools change together,
// or this file is red. It reads the committed doc, catalog and cast bytes through `?raw`, and reads the doc's ink
// through the gate's own classifier.
import { expect, test } from 'vitest';

import doc from '../../../docs/STAGING-DSL.md?raw';
import catalogText from '../../../assets/catalog.json?raw';
import castText from '../../../story/cast.json?raw';
import { classify } from '../../scripts/story/classify.ts';
import { GLOBALS_PATH, LINT_CODES, lintSources, tagsOf } from '../../scripts/story/lint.ts';
import type { SourceLintInput } from '../../scripts/story/lint.ts';
import { assetIndex, decodeAssetCatalog, decodeCast } from './catalog.ts';
import type { AssetCatalog, Cast } from './catalog.ts';
import type { AssetIndex, ChapterId } from './staging.ts';
import { TAG_KINDS, parseTags, tagKind } from './tags.ts';

const BOM = String.fromCharCode(0xfeff);
const INVALID_MARKER = '<!-- dsl: invalid -->';

function text(raw: string): string {
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

const LINES = text(doc).split(/\r?\n/);

function committed(): { assets: AssetIndex; cast: Cast } {
  const catalog = decodeAssetCatalog(JSON.parse(text(catalogText)));
  if (!catalog.ok) {
    throw new Error(`invariant: the committed catalog decodes: ${JSON.stringify(catalog.error)}`);
  }
  const value: AssetCatalog = catalog.value;
  const cast = decodeCast(JSON.parse(text(castText)), value);
  if (!cast.ok) {
    throw new Error(`invariant: the committed cast decodes: ${JSON.stringify(cast.error)}`);
  }
  return { assets: assetIndex(value), cast: cast.value };
}

/** The lines of `## <n>.` up to the next `## ` heading. */
function section(n: number): string[] {
  const start = LINES.findIndex((l) => l.startsWith(`## ${n}.`));
  if (start < 0) {
    throw new Error(`invariant: STAGING-DSL.md has a section ${n}`);
  }
  const end = LINES.findIndex((l, i) => i > start && l.startsWith('## '));
  return LINES.slice(start + 1, end < 0 ? LINES.length : end);
}

/** A ```ink block: its first content line (1-based in the doc) and its source. */
type Block = { line: number; invalid: boolean; source: string };

/** Every ` ```ink ` block; `invalid` when the nearest non-blank line above is the counter-example marker. */
function inkBlocks(): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < LINES.length; i += 1) {
    if (LINES[i] !== '```ink') {
      continue;
    }
    let above = i - 1;
    while (above >= 0 && (LINES[above] ?? '').trim() === '') {
      above -= 1;
    }
    let j = i + 1;
    while (j < LINES.length && LINES[j] !== '```') {
      j += 1;
    }
    blocks.push({ line: i + 2, invalid: LINES[above] === INVALID_MARKER, source: LINES.slice(i + 1, j).join('\n') });
    i = j;
  }
  return blocks;
}

/** The tags of each line of a block, as the gate's classifier reads them, with the doc line number. */
function blockTags(block: Block): Array<{ line: number; tags: string[] }> {
  return classify(block.source).map((l) => ({ line: block.line + l.line - 1, tags: tagsOf(l.cls).map((t) => t.text) }));
}

function chapterId(id: string): ChapterId {
  return id as ChapterId; // the wrapper chapters are named here, as story/chapters.json would name them
}

test('dsl-doc: headings equal parser kinds', () => {
  const headings = section(6).flatMap((l) => /^### `([^`]+)`$/.exec(l)?.[1] ?? []);
  const kinds: readonly string[] = TAG_KINDS;
  expect({
    notInParser: headings.filter((h) => !kinds.includes(h)),
    notInDoc: kinds.filter((k) => !headings.includes(k)),
  }).toEqual({ notInParser: [], notInDoc: [] });
  expect(headings).toHaveLength(new Set(headings).size);
});

test('dsl-doc: tag table equals parser kinds', () => {
  const rows = section(6)
    .filter((l) => l.startsWith('| `'))
    .map((l) => l.split(/(?<!\\)\|/).map((cell) => cell.trim()));
  const kinds = rows.map((cells) => /^`([^`]+)`$/.exec(cells[1] ?? '')?.[1] ?? cells[1]);
  expect(kinds).toEqual([...TAG_KINDS]);
  for (const cells of rows) {
    const kind = /^`([^`]+)`$/.exec(cells[1] ?? '')?.[1];
    const typed = cells[cells.length - 2] ?? '';
    if (kind === 'id') {
      expect(typed, 'id row').toContain('not a command');
    } else {
      expect(typed, `${kind} row`).toBe(`\`${kind}\``);
    }
  }
});

test('dsl-doc: every example tag parses against the catalog', () => {
  const { assets } = committed();
  const blocks = inkBlocks();
  const failures: string[] = [];
  const kindsSeen = new Map<string, number>();
  let checked = 0;
  for (const block of blocks.filter((b) => !b.invalid)) {
    for (const { line, tags } of blockTags(block)) {
      for (const tag of tags) {
        const kind = tagKind(tag) ?? tag;
        kindsSeen.set(kind, (kindsSeen.get(kind) ?? 0) + 1);
        checked += 1;
      }
      for (const e of parseTags(tags, assets).errors) {
        failures.push(`STAGING-DSL.md:${line}: '${e.tag}' ${e.reason} (${e.detail})`);
      }
    }
  }
  expect(failures).toEqual([]);
  // Non-vacuity floors, measured on the doc at f6e2624: 14 valid blocks, 70 tags, every kind present.
  expect(blocks.filter((b) => !b.invalid).length).toBeGreaterThanOrEqual(14);
  expect(checked).toBeGreaterThanOrEqual(70);
  expect([...TAG_KINDS].filter((k) => !kindsSeen.has(k))).toEqual([]);
  // The counter-example is the only invalid block, and it really is invalid.
  const invalid = blocks.filter((b) => b.invalid);
  expect(invalid).toHaveLength(1);
  const invalidErrors = invalid.flatMap((b) => blockTags(b)).flatMap(({ tags }) => parseTags(tags, assets).errors);
  expect(invalidErrors.length).toBeGreaterThanOrEqual(1);
});

test('dsl-doc: lint table equals lint codes', () => {
  const rows = section(11)
    .filter((l) => l.startsWith('| `'))
    .map((l) => l.split(/(?<!\\)\|/).map((cell) => cell.trim()));
  const table: Array<readonly [string, string]> = rows.flatMap((cells) =>
    [...(cells[1] ?? '').matchAll(/`([^`]+)`/g)].map((m) => [m[1] ?? '', cells[2] ?? ''] as const),
  );
  expect(table).toHaveLength(50);
  const tool: Record<string, string> = LINT_CODES;
  expect({
    notInTool: table.filter(([code]) => !Object.hasOwn(tool, code)).map(([code]) => code),
    notInDoc: Object.keys(tool).filter((code) => !table.some(([c]) => c === code)),
    severity: table.filter(([code, sev]) => Object.hasOwn(tool, code) && tool[code] !== sev).map(([code]) => code),
  }).toEqual({ notInTool: [], notInDoc: [], severity: [] });
});

test('dsl-doc: counter-example yields its listed codes', () => {
  const { assets, cast } = committed();
  const invalid = inkBlocks().find((b) => b.invalid);
  if (invalid === undefined) {
    throw new Error('invariant: STAGING-DSL.md has a counter-example');
  }
  // The codes the doc lists under the counter-example, one bullet per failing point, in the doc's own words.
  const start = LINES.findIndex((l) => l.startsWith('Each line of the counter-example fails'));
  const listed: string[] = [];
  for (let i = start + 1; i < LINES.length && (LINES[i] ?? '').startsWith('- '); i += 1) {
    const before = (LINES[i] ?? '').split('—')[0] ?? '';
    listed.push(...[...before.matchAll(/`([a-z]+\/[a-z-]+)`/g)].map((m) => m[1] ?? ''));
  }
  expect(listed).toHaveLength(7);
  const first = /^=== (\w+) ===$/m.exec(invalid.source)?.[1] ?? '';
  const input: SourceLintInput = {
    files: new Map([
      [GLOBALS_PATH, ''],
      ['ch1/main.ink', `INCLUDE ../common/globals.ink\n-> ${first}\n${invalid.source}`],
    ]),
    chapters: [{ id: chapterId('ch1'), paid: false, entry: 'ch1/main.ink' }],
    assets,
    cast,
  };
  const found = lintSources(input).map((f) => f.code);
  expect([...found].sort()).toEqual([...listed].sort());
});

test('dsl-doc: examples lint clean', () => {
  const { assets, cast } = committed();
  const blocks = inkBlocks().filter((b) => !b.invalid);
  // The globals the examples read; the lint checks declarations, not uses, so this is only for realism.
  const globals = 'VAR g_trust_ally = 0\nVAR g_lied_to_ally = false';
  const errors: string[] = [];
  let linted = 0;
  for (const block of blocks) {
    const ch = /#id:(ch[1-9][0-9]*)\./.exec(block.source)?.[1] ?? 'ch1';
    const entry = `${ch}/main.ink`;
    const files = new Map<string, string>([[GLOBALS_PATH, globals]]);
    if (block.source.startsWith('INCLUDE ')) {
      // §12 is a complete entry file: it is linted as the entry itself.
      files.set(entry, block.source);
    } else {
      const first = /^=== (\w+) ===$/m.exec(block.source)?.[1] ?? '';
      files.set(entry, `INCLUDE ../common/globals.ink\nINCLUDE example.ink\n-> ${first}`);
      files.set(`${ch}/example.ink`, block.source);
    }
    const findings = lintSources({ files, chapters: [{ id: chapterId(ch), paid: false, entry }], assets, cast });
    for (const f of findings.filter((x) => x.severity === 'E')) {
      errors.push(`block at STAGING-DSL.md:${block.line} (${f.file}:${f.line}): ${f.code} ${f.message}`);
    }
    linted += 1;
  }
  expect(errors).toEqual([]);
  expect(linted).toBeGreaterThanOrEqual(14);
});
