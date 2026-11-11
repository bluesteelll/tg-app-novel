// The asset tool (PROTOTYPE-PLAN "Asset pipeline", K23): reads the chapter list, the catalog and the story tool's
// usage.json; renders every used placeholder and every cover, encodes them (sharp AVIF + WebP, synthesized WAV);
// plans the files, the per-chapter manifests, covers.json and the paid file fingerprints; then sweeps its two asset
// directories of everything not planned and writes. A failed run writes and deletes nothing. With a shot list
// (story/shots.json, shots §2.4-2.6) it reads build/shots.json too, tiers every shot file it lists per file, and
// synthesizes, packs and encodes those files (placeholders until SH3c).
// CLI: node scripts/assets.ts [--root <repo>]   (exit 1 on any input error)
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AssetCatalog, ChapterListEntry } from '../src/story/catalog.ts';
import type { AssetId, BgId, ChapterId } from '../src/story/staging.ts';
import { encodeImage } from './assets/encode.ts';
import type { EncodedImage, HalfAsk } from './assets/encode.ts';
import {
  ASSET_OUT,
  TRIMMED_NAMESPACES,
  assetUsage,
  canvasProblems,
  catalogAudio,
  catalogImage,
  decodeAssetCatalog,
  halfAsk,
  isShotFile,
  planAssets,
  tierAll,
} from './assets/manifest.ts';
import type { ChapterShotKeys, Encoded } from './assets/manifest.ts';
import { CANONICAL_SIZE, renderPlaceholder } from './assets/placeholder.ts';
import {
  castProblems,
  faceNeedProblems,
  facesOf,
  loopAtlas,
  loopRig,
  manifestLook,
  packShot,
  placeholderDepth,
  placeholderLayers,
  plateProblems,
  shotFileSvg,
  shotRig,
} from './assets/shots.ts';
import type { ChapterNeed, PackedFile, ShotLayers, ShotPack } from './assets/shots.ts';
import { synthWav } from './assets/synth.ts';
import { decodeChapterList, decodeStoryUsage } from './story/emit.ts';
import { SHOTS_FILE, decodeShotList, effectiveCatalog } from './story/shots/list.ts';
import type { Shot, ShotList } from './story/shots/list.ts';
import { SHOT_USAGE_FILE, decodeShotUsage } from './story/shots/usage.ts';
import type { ShotNeed, ShotUsage } from './story/shots/usage.ts';

/**
 * The encoders, injectable so planner and CLI tests stay fast (the real ones are the default). `trim`: cut the image
 * to its alpha box (char and prop, MEMORY-PLAN 4.B); `half`: which half pair to make (manifest.ts `halfAsk`, MEMORY-PLAN
 * 4.C), required here so the tool cannot drop the ask.
 */
export type Encoders = {
  encodeImage: (input: Uint8Array, o: { trim: boolean; half: HalfAsk }) => Promise<EncodedImage>;
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

/** One shot of build/shots.json as the tool encodes it: its declared (or implied) shot, its layers, its packing. */
type PackedShot = { readonly shot: Shot; readonly layers: ShotLayers; readonly pack: ShotPack };

/** The packed shots, the input problems that kept a shot from being packed, and those shots (critique O2). */
type ShotPacking = { readonly shots: Map<BgId, PackedShot>; readonly problems: string[]; readonly refused: ReadonlySet<BgId> };

/**
 * Every shot of build/shots.json, packed (shots §4.2 steps 7-8): its layer set synthesized from the union of its
 * chapters' face needs, its cast in the shot list's draw order (an implied shot has none), on the placeholder plate.
 * A need the catalog cannot satisfy (a stale build/shots.json) is reported, and its shot is not packed.
 */
function packShots(usage: ShotUsage, list: ShotList, catalog: AssetCatalog): ShotPacking {
  const needs = new Map<BgId, ChapterNeed[]>();
  for (const [ch, c] of Object.entries(usage.chapters) as [ChapterId, ShotUsage['chapters'][ChapterId]][]) {
    for (const [s, need] of Object.entries(c.shots) as [BgId, ShotNeed][]) {
      needs.set(s, [...(needs.get(s) ?? []), { ch, need }]);
    }
  }
  const shots = new Map<BgId, PackedShot>();
  const problems: string[] = [];
  const refused = new Set<BgId>();
  for (const [s, ns] of [...needs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const first = ns[0]?.need;
    const shot = list.shots.find((x) => x.id === s) ?? (first === undefined ? undefined : { id: s, loc: first.loc, frame: first.frame, cast: [] });
    const stale = faceNeedProblems(s, ns, catalog);
    if (stale.length > 0) {
      problems.push(...stale);
      refused.add(s);
    } else if (shot !== undefined) {
      const layers = placeholderLayers(shot, facesOf(ns.map((n) => n.need)), catalog, CANONICAL_SIZE.bg);
      shots.set(s, { shot, layers, pack: packShot(layers) });
    }
  }
  return { shots, problems, refused };
}

/**
 * Per chapter of build/shots.json, what its manifest carries (shots §4.5, CH D5): a rig per shot it shows, cut to the
 * expressions and talk it needs, on the placeholder depth grid (SH3c brings real ones), and its look.
 */
function chapterShotKeys(usage: ShotUsage, shots: ReadonlyMap<BgId, PackedShot>): Map<string, ChapterShotKeys> {
  const depth = placeholderDepth();
  const out = new Map<string, ChapterShotKeys>();
  for (const [ch, c] of Object.entries(usage.chapters)) {
    const rigs = (Object.entries(c.shots) as [BgId, ShotNeed][])
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([s, need]) => {
        const packed = shots.get(s);
        if (packed === undefined) {
          throw new Error(`invariant: ${s}, shown by ${ch}, is packed`);
        }
        return [s, shotRig(packed.layers, packed.pack, need, depth)] as const;
      });
    out.set(ch, { shots: Object.fromEntries(rigs), look: manifestLook(c.look) });
  }
  return out;
}

/**
 * build/shots.json against the chapter list and the packer: it holds exactly the listed chapters (else the story
 * tool's output is stale), and every shot file a chapter lists is one its shot's needs make. A refused shot's files are
 * skipped: its own problem is the one message (critique O2).
 */
function shotUsageProblems(
  usage: ShotUsage,
  chapters: readonly ChapterListEntry[],
  shots: ReadonlyMap<BgId, PackedShot>,
  refused: ReadonlySet<BgId>,
): string[] {
  const listed = new Set<string>(chapters.map((c) => c.id));
  const problems = [
    ...chapters.filter((c) => !Object.hasOwn(usage.chapters, c.id)).map((c) => `${SHOT_USAGE_FILE} has no chapter ${c.id} (run the story tool)`),
    ...Object.keys(usage.chapters)
      .filter((ch) => !listed.has(ch))
      .map((ch) => `${SHOT_USAGE_FILE} names ${ch}, which story/chapters.json does not list (run the story tool)`),
  ];
  for (const [ch, c] of Object.entries(usage.chapters)) {
    for (const id of c.assets.filter(isShotFile)) {
      const shot = id.split('/')[1] as BgId; // a shot file id's second segment is its shot (ASSET_ID_RE)
      if (!refused.has(shot) && shots.get(shot)?.pack.files.has(id) !== true) {
        problems.push(`${SHOT_USAGE_FILE}: ${ch} lists ${id}, which its shot's needs do not make (run the story tool)`);
      }
    }
  }
  return problems;
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
  const source = read('assets/catalog.json', decodeAssetCatalog);
  const storyUsage = read(USAGE_FILE, decodeStoryUsage);
  // Shots §4.1: a bg's `src` form names its shot's source directory; extracting it is SH3c's, so until then the tool
  // names it and stops rather than encode anything in its place.
  for (const [id, bg] of Object.entries(source?.bg ?? {})) {
    if ('src' in bg) {
      problems.push(`bg/${id}: src ${bg.src} waits for extraction (SH3c)`);
    }
  }
  // Shots §2.4 (W10): a loop prop's frames are one atlas `prop/<id>`; a placeholder's is synthesized here, a src one waits.
  const loops = new Map<AssetId, { readonly atlas: PackedFile; readonly fps: number }>();
  for (const [id, prop] of Object.entries(source?.prop ?? {})) {
    const atlas = `prop/${id}` as AssetId; // a catalog prop id
    if (!('loop' in prop)) {
      continue;
    }
    if ('src' in prop.loop) {
      problems.push(`${atlas}: src ${prop.loop.src} waits for extraction (SH3c)`);
    } else {
      loops.set(atlas, { atlas: loopAtlas(atlas, prop.loop.placeholder.hue, prop.loop.placeholder.frames), fps: prop.loop.fps });
    }
  }
  // Shots §2.4: with a shot list, the effective catalog (an implied placeholder bg per declared shot it lacks, SH2's
  // cut Q7) and build/shots.json, which the story tool writes beside usage.json; without one, today's path exactly.
  const hasShotList = existsSync(path.join(root, ...SHOTS_FILE.split('/')));
  const shotList = source !== null && hasShotList ? read(SHOTS_FILE, (raw) => decodeShotList(raw, source)) : null;
  let shotUsage: ShotUsage | null = null;
  if (shotList !== null) {
    if (existsSync(path.join(root, ...SHOT_USAGE_FILE.split('/')))) {
      shotUsage = read(SHOT_USAGE_FILE, decodeShotUsage);
    } else {
      problems.push(`${SHOT_USAGE_FILE}: missing (${SHOTS_FILE} exists: run the story tool)`);
    }
  }
  const catalog = source !== null && shotList !== null ? effectiveCatalog(source, shotList) : source;
  const packing: ShotPacking =
    shotList !== null && shotUsage !== null && catalog !== null ? packShots(shotUsage, shotList, catalog) : { shots: new Map(), problems: [], refused: new Set() };
  const { shots } = packing;
  problems.push(...packing.problems);
  if (chapters !== null && shotUsage !== null) {
    problems.push(...shotUsageProblems(shotUsage, chapters, shots, packing.refused));
  }
  if (chapters === null || catalog === null || storyUsage === null || problems.length > 0) {
    for (const p of problems) {
      console.error(`assets: ${p}`);
    }
    return 1;
  }
  const usage = assetUsage(storyUsage, shotUsage);
  const tiers = tierAll(catalog, usage, chapters);
  if (!tiers.ok) {
    for (const p of tiers.error) {
      console.error(`assets: ${p}`);
    }
    return 1;
  }
  const packedFiles = new Map([...shots.values()].flatMap((v) => [...v.pack.files]));
  // 2. Encode every shipped asset, one at a time: the peak is one decoded canvas.
  const encoded = new Map<AssetId, Encoded>();
  for (const [id, tier] of tiers.value) {
    if (tier === 'unused') {
      console.log(`asset unused: ${id}`);
      continue;
    }
    const image = catalogImage(catalog, id);
    const audio = catalogAudio(catalog, id);
    const packed = packedFiles.get(id) ?? loops.get(id)?.atlas;
    if (packed !== undefined) {
      // A shot file or a loop atlas: never trimmed (its frames are its rig's), with its half pair like any bg (§4.2 step 7).
      const svg = new TextEncoder().encode(shotFileSvg(packed));
      encoded.set(id, { kind: 'image', ...(await encoders.encodeImage(svg, { trim: false, half: halfAsk(id, tier) })) });
    } else if (image !== undefined) {
      const svg = renderPlaceholder(id, image).svg;
      const trim = TRIMMED_NAMESPACES.includes(id.slice(0, id.indexOf('/')));
      const half = halfAsk(id, tier);
      encoded.set(id, { kind: 'image', ...(await encoders.encodeImage(new TextEncoder().encode(svg), { trim, half })) });
    } else if (audio !== undefined && 'placeholder' in audio) {
      const role = id.startsWith('bgm/') ? 'bgm' : 'sfx';
      encoded.set(id, { kind: 'audio', role, ...encoders.synthWav(role, audio.placeholder) });
    } else {
      // The catalog decoder admits placeholders only: a real source is PP "Later".
      throw new Error(`invariant: ${id} is a catalog placeholder before it is encoded`);
    }
  }
  // 3. The canvases are input errors, reported before planning (the planner's own decode would throw on an odd file);
  // so are a shot's plate (R5) and its cast's masks (R9), shots §4.3.
  const shotChecks = [...shots].flatMap(([s, { shot, layers }]) => {
    const plate = encoded.get(`bg/${s}` as AssetId); // the shot's plate is its bg, encoded above when a chapter uses it
    return [...(plate?.kind === 'image' ? plateProblems(s, shot.frame, plate.w, plate.h) : []), ...castProblems(layers)];
  });
  const canvases = [...canvasProblems(encoded), ...shotChecks];
  if (canvases.length > 0) {
    for (const p of canvases) {
      console.error(`assets: ${p}`);
    }
    return 1;
  }
  // 4. Plan, sweep, write.
  const plan = planAssets({
    chapters,
    usage,
    tiers: tiers.value,
    encoded,
    ...(shotUsage === null ? {} : { shots: chapterShotKeys(shotUsage, shots) }),
    loops: new Map([...loops].map(([id, l]) => [id, loopRig(l.atlas, l.fps)])),
  });
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
