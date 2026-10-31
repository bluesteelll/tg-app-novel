// The asset tool (PROTOTYPE-PLAN "Asset pipeline", K23): reads the chapter list, the catalog and the story tool's
// usage.json; renders every used placeholder and every cover, encodes them (sharp AVIF + WebP, synthesized WAV);
// plans the files, the per-chapter manifests, covers.json and the paid file fingerprints; then sweeps its two asset
// directories of everything not planned and writes. A failed run writes and deletes nothing.
// CLI: node scripts/assets.ts [--root <repo>]   (exit 1 on any input error)
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AssetId } from '../src/story/staging.ts';
import { encodeImage } from './assets/encode.ts';
import type { EncodedImage } from './assets/encode.ts';
import {
  ASSET_OUT,
  assetUsage,
  catalogAudio,
  catalogImage,
  decodeAssetCatalog,
  planAssets,
  tierAll,
} from './assets/manifest.ts';
import type { Encoded } from './assets/manifest.ts';
import { renderPlaceholder } from './assets/placeholder.ts';
import { synthWav } from './assets/synth.ts';
import { decodeChapterList, decodeStoryUsage } from './story/emit.ts';

/** The encoders, injectable so planner and CLI tests stay fast (the real ones are the default). */
export type Encoders = {
  encodeImage: (input: Uint8Array) => Promise<EncodedImage>;
  synthWav: typeof synthWav;
};

const USAGE_FILE = 'server/content/build/usage.json';

/** A repo JSON file, parsed; else why not. */
function readJson(root: string, rel: string): { ok: true; value: unknown } | { ok: false; why: string } {
  const abs = path.join(root, ...rel.split('/'));
  if (!existsSync(abs)) {
    return { ok: false, why: `${rel}: missing` };
  }
  try {
    const text = readFileSync(abs, 'utf8');
    return { ok: true, value: JSON.parse(text.startsWith('﻿') ? text.slice(1) : text) };
  } catch (e) {
    return { ok: false, why: `${rel}: not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** A decoder issue as text: the story tool's strings as they are, a catalog issue as `<path>: <detail>`. */
function issueText(e: unknown): string {
  if (typeof e === 'string') {
    return e;
  }
  const i = e as { path?: unknown; detail?: unknown }; // a CatalogIssue from the src/ decoders
  return `${String(i.path)}: ${String(i.detail)}`;
}

/** Every file under the tool's own directory that the plan does not hold (repo-relative posix paths). */
function stale(root: string, dir: string, plan: ReadonlyMap<string, Uint8Array>): string[] {
  const abs = path.join(root, ...dir.split('/'));
  if (!existsSync(abs)) {
    return [];
  }
  return readdirSync(abs)
    .map((name) => `${dir}/${name}`)
    .filter((rel) => !plan.has(rel));
}

/** Runs the tool on the repository at `root`; returns the exit code. */
export async function main(argv: readonly string[], root: string, encoders: Encoders = { encodeImage, synthWav }): Promise<number> {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--root' && value !== undefined) {
      root = path.resolve(value);
      i++;
    } else {
      console.error(`assets: unknown argument ${arg ?? ''}; usage: node scripts/assets.ts [--root <repo>]`);
      return 2;
    }
  }
  // 1. Inputs; every problem is reported before anything is encoded.
  const problems: string[] = [];
  const read = <T>(rel: string, decode: (raw: unknown) => { ok: true; value: T } | { ok: false; error: unknown[] }): T | null => {
    const raw = readJson(root, rel);
    if (!raw.ok) {
      problems.push(raw.why);
      return null;
    }
    const decoded = decode(raw.value);
    if (!decoded.ok) {
      problems.push(...decoded.error.map((e) => `${rel}: ${issueText(e)}`));
      return null;
    }
    return decoded.value;
  };
  const chapters = read('story/chapters.json', decodeChapterList);
  const catalog = read('assets/catalog.json', decodeAssetCatalog);
  const storyUsage = read(USAGE_FILE, decodeStoryUsage);
  if (chapters === null || catalog === null || storyUsage === null) {
    for (const p of problems) {
      console.error(`assets: ${p}`);
    }
    return 1;
  }
  const usage = assetUsage(storyUsage);
  const tiers = tierAll(catalog, usage, chapters);
  if (!tiers.ok) {
    for (const p of tiers.error) {
      console.error(`assets: ${p}`);
    }
    return 1;
  }
  // 2. Encode every shipped asset, one at a time: the peak is one decoded canvas.
  const encoded = new Map<AssetId, Encoded>();
  for (const [id, tier] of tiers.value) {
    if (tier === 'unused') {
      console.log(`asset unused: ${id}`);
      continue;
    }
    const image = catalogImage(catalog, id);
    const audio = catalogAudio(catalog, id);
    if (image !== undefined) {
      const svg = renderPlaceholder(id, image).svg;
      encoded.set(id, { kind: 'image', ...(await encoders.encodeImage(new TextEncoder().encode(svg))) });
    } else if (audio !== undefined && 'placeholder' in audio) {
      const role = id.startsWith('bgm/') ? 'bgm' : 'sfx';
      encoded.set(id, { kind: 'audio', role, ...encoders.synthWav(role, audio.placeholder) });
    } else {
      // The catalog decoder admits placeholders only: a real source is PP "Later".
      throw new Error(`invariant: ${id} is a catalog placeholder before it is encoded`);
    }
  }
  // 3. Plan, sweep, write.
  const plan = planAssets({ chapters, usage, tiers: tiers.value, encoded });
  const swept = [...stale(root, ASSET_OUT.public, plan.files), ...stale(root, ASSET_OUT.paid, plan.files)];
  for (const rel of swept) {
    rmSync(path.join(root, ...rel.split('/')), { recursive: true, force: true });
  }
  for (const [rel, bytes] of plan.files) {
    const abs = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
  }
  const { summary } = plan;
  console.log(
    `assets: ${summary.public.length} public, ${summary.paid.length} paid, ${summary.unused.length} unused, ` +
      `${summary.covers.length} covers; ${plan.files.size} files written, ${swept.length} stale removed`,
  );
  return 0;
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
  // /tmp): only canonical forms compare, or a linked path would skip main() and exit 0 having written nothing.
  const self = canonical(fileURLToPath(moduleUrl));
  const invoked = canonical(argv1);
  // Windows paths compare case-insensitively (drive letters arrive as d: or D:).
  return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
}

if (invokedDirectly(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  main(process.argv.slice(2), repoRoot).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
