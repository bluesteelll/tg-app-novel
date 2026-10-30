// The two-way contract of docs/STAGING-DSL.md (its "Two-way check" bullet): the doc and the tools change together,
// or this file is red. It reads the committed doc and catalog bytes through `?raw`.
import { expect, test } from 'vitest';

import doc from '../../../docs/STAGING-DSL.md?raw';
import catalogText from '../../../assets/catalog.json?raw';
import { assetIndex, decodeAssetCatalog } from './catalog.ts';
import type { AssetIndex } from './staging.ts';
import { TAG_KINDS, parseTags, tagKind } from './tags.ts';

const BOM = String.fromCharCode(0xfeff);
const LINES = (doc.startsWith(BOM) ? doc.slice(1) : doc).split(/\r?\n/);
const INVALID_MARKER = '<!-- dsl: invalid -->';

function catalogIndex(): AssetIndex {
  const text = catalogText.startsWith(BOM) ? catalogText.slice(1) : catalogText;
  const r = decodeAssetCatalog(JSON.parse(text));
  if (!r.ok) {
    throw new Error(`invariant: the committed catalog decodes: ${JSON.stringify(r.error)}`);
  }
  return assetIndex(r.value);
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

type Block = { line: number; invalid: boolean; lines: ReadonlyArray<{ line: number; text: string }> };

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
    const lines: Array<{ line: number; text: string }> = [];
    let j = i + 1;
    for (; j < LINES.length && LINES[j] !== '```'; j += 1) {
      lines.push({ line: j + 1, text: LINES[j] ?? '' });
    }
    blocks.push({ line: i + 1, invalid: LINES[above] === INVALID_MARKER, lines });
    i = j;
  }
  return blocks;
}

/**
 * Test-only tag extraction for one ink line: the text after each unescaped `#`, cut at a choice's closing `]`.
 * classify.ts replaces it once it exists, so the doc is then checked through the gate's own line grammar.
 */
function lineTags(text: string): string[] {
  const parts = text.split(/(?<!\\)#/).slice(1);
  return parts.map((p) => (p.includes(']') ? p.slice(0, p.indexOf(']')) : p).trim());
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
  const index = catalogIndex();
  const blocks = inkBlocks();
  const failures: string[] = [];
  const kindsSeen = new Map<string, number>();
  let checked = 0;
  for (const block of blocks.filter((b) => !b.invalid)) {
    for (const { line, text } of block.lines) {
      const tags = lineTags(text);
      for (const tag of tags) {
        const kind = tagKind(tag) ?? tag;
        kindsSeen.set(kind, (kindsSeen.get(kind) ?? 0) + 1);
        checked += 1;
      }
      for (const e of parseTags(tags, index).errors) {
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
  const invalidErrors = (invalid[0]?.lines ?? []).flatMap(({ text }) => parseTags(lineTags(text), index).errors);
  expect(invalidErrors.length).toBeGreaterThanOrEqual(1);
});
