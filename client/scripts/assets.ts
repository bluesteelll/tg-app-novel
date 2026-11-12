// The asset tool (PROTOTYPE-PLAN "Asset pipeline", K23): reads the chapter list, the catalog and the story tool's
// usage.json; renders every used placeholder and every cover, encodes them (sharp AVIF + WebP, synthesized WAV);
// plans the files, the per-chapter manifests, covers.json and the paid file fingerprints; then sweeps its two asset
// directories of everything not planned and writes. A failed run writes and deletes nothing. With a shot list
// (story/shots.json, shots §2.4-2.6) it reads build/shots.json too, tiers every shot file it lists per file, and packs
// and encodes those files: synthesized for a placeholder shot, extracted from its source directory for a `src` one
// (assets/src/shot/<s>/, shots §4.1-4.4, lane SH3c).
// CLI: node scripts/assets.ts [--root <repo>]   (exit 1 on any input error)
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AssetCatalog, ChapterListEntry, Result } from '../src/story/catalog.ts';
import type { AssetId, BgId, ChapterId } from '../src/story/staging.ts';
import type { WorldSource } from '../src/world/types.ts';
import { decodeDepth, decodeRaster, encodeImage, encodeRaster, halfRgba, imageFacts } from './assets/encode.ts';
import type { EncodedImage, HalfAsk } from './assets/encode.ts';
import { DEFAULT_Q, alphaProblems, cropRaster, decodeShotSource, extractShot, roomPropRects } from './assets/extract.ts';
import type { RoomRect } from './assets/extract.ts';
import {
  ASSET_OUT,
  TRIMMED_NAMESPACES,
  assetUsage,
  canvasProblems,
  catalogAudio,
  catalogImage,
  decodeAssetCatalog,
  decodeWorldSource,
  gatedCopies,
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
  loopFrameProblems,
  loopRig,
  manifestLook,
  packProblems,
  packShot,
  placeholderDepth,
  placeholderLayers,
  plateProblems,
  shotFileRaster,
  shotFileSvg,
  shotRig,
  srcLoopAtlas,
} from './assets/shots.ts';
import type { ChapterNeed, PackedFile, Raster, ShotLayers, ShotPack } from './assets/shots.ts';
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
  /**
   * A `src` shot's plate and packed files (shots §4.4; RULINGS 267's q search inside). Optional, so a stand-in set
   * without it still type-checks (scan-dist.test.ts); `main` takes the real one then.
   */
  encodeRaster?: typeof encodeRaster;
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

/**
 * One shot of build/shots.json as the tool encodes it: its declared (or implied) shot, its layers, its packing, and
 * its depth grid (null: a placeholder shot's, `placeholderDepth`).
 */
type PackedShot = {
  readonly shot: Shot;
  readonly layers: ShotLayers<unknown>;
  readonly pack: ShotPack<unknown>;
  readonly depth: Uint8Array | null;
};

/**
 * A raster the tool encodes (shots §4.4): its px, made when its turn comes; the AVIF quality (a plate's) or the q
 * search's start (an alpha file's, RULINGS 267); whether it is searched.
 */
type RasterJob = { readonly px: () => Promise<Raster>; readonly q: number; readonly search: boolean };

/**
 * The packed shots, the input problems that kept a shot from being packed, and those shots (critique O2); R8's
 * warnings; the files to encode from px (a `src` shot's plate and packed files) and from SVG (a placeholder's).
 */
type ShotPacking = {
  readonly shots: Map<BgId, PackedShot>;
  readonly problems: string[];
  readonly refused: ReadonlySet<BgId>;
  readonly warnings: readonly string[];
  readonly rasters: ReadonlyMap<AssetId, RasterJob>;
  readonly svgFiles: ReadonlyMap<AssetId, PackedFile>;
};

/** A `src` shot, extracted and packed: the shot, its R8 warnings, its files to encode. */
type SrcShot = { readonly packed: PackedShot; readonly warnings: readonly string[]; readonly rasters: ReadonlyMap<AssetId, RasterJob> };

/** A source directory's file the decoders accept (D5, D12): 8-bit PNG; `depth.png` an 8- or 16-bit grey PNG. */
async function sourceFileProblem(s: BgId, name: string, bytes: Uint8Array): Promise<string | null> {
  const f = await imageFacts(bytes);
  const depth = name === 'depth.png';
  const fits = f !== null && f.format === 'png' && (depth ? (f.depth === 'uchar' || f.depth === 'ushort') && f.channels <= 2 : f.depth === 'uchar');
  if (fits) {
    return null;
  }
  const what = f === null ? 'not an image' : `${f.format}, ${f.depth}, ${f.channels} channels`;
  return depth ? `${s}/depth.png: ${what}, not an 8- or 16-bit greyscale PNG (D12)` : `${s}/${name}: ${what}, not an 8-bit PNG (D5)`;
}

/**
 * Shots §4.1-4.4 for one `src` shot: its shot.json; R5 on the crop before any pixel is decoded; every PNG of its
 * directory an accepted format; R8's room prop rects (a `room` shot, from each showing chapter's world); the
 * extraction (`extractShot`, every other check); the packing. Its plate is the crop of plate.png at the shot's q, its
 * packed files are searched from it. Every problem is returned by name, nothing thrown.
 */
async function srcShot(
  root: string,
  shot: Shot,
  src: string,
  needs: readonly ChapterNeed[],
  world: (ch: ChapterId) => WorldSource | null,
): Promise<Result<SrcShot, string[]>> {
  const s = shot.id;
  const dir = path.join(root, 'assets', 'src', ...src.split('/'));
  const raw = readJson(root, `assets/src/${src}/shot.json`);
  if (!raw.ok) {
    return { ok: false, error: [raw.why] };
  }
  const decoded = decodeShotSource(raw.value, s);
  if (!decoded.ok) {
    return decoded;
  }
  const source = decoded.value;
  const r5 = plateProblems(s, shot.frame, source.crop[2], source.crop[3]);
  if (r5.length > 0) {
    return { ok: false, error: r5 };
  }
  const formats: string[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.png')).sort()) {
    const p = await sourceFileProblem(s, name, readFileSync(path.join(dir, name)));
    if (p !== null) {
      formats.push(p);
    }
  }
  if (formats.length > 0) {
    return { ok: false, error: formats };
  }
  const file = (name: string): string | null => {
    const abs = path.join(dir, name);
    return existsSync(abs) ? abs : null;
  };
  const rooms: RoomRect[] =
    shot.frame === 'room'
      ? [...new Set(needs.map((n) => n.ch))].sort().flatMap((ch) => {
          const w = world(ch);
          return w === null ? [] : roomPropRects(w, s);
        })
      : [];
  const x = await extractShot({
    shot,
    source,
    needs,
    load: async (name) => {
      const abs = file(name);
      return abs === null ? null : decodeRaster(readFileSync(abs));
    },
    loadDepth: async () => {
      const abs = file('depth.png');
      return abs === null ? null : decodeDepth(readFileSync(abs));
    },
    rooms,
  });
  if (!x.ok) {
    return x;
  }
  const { layers, depth, warnings } = x.value;
  const unpackable = packProblems(layers);
  if (unpackable.length > 0) {
    return { ok: false, error: unpackable };
  }
  const pack = packShot(layers);
  const rasters = new Map<AssetId, RasterJob>([
    [`bg/${s}` as AssetId, { px: async () => cropRaster(await decodeRaster(readFileSync(path.join(dir, 'plate.png'))), source.crop), q: source.q, search: false }],
  ]);
  for (const [id, f] of pack.files) {
    rasters.set(id, { px: () => Promise.resolve(shotFileRaster(f)), q: source.q, search: true });
  }
  return { ok: true, value: { packed: { shot, layers, pack, depth }, warnings, rasters } };
}

/**
 * Every shot of build/shots.json, packed (shots §4.2 steps 7-8). A placeholder shot's layer set is synthesized from
 * the union of its chapters' face needs, its cast in the shot list's draw order (an implied shot has none), on the
 * placeholder plate; a `src` shot's is extracted from its source directory (`srcShot`). A need the catalog cannot
 * satisfy (a stale build/shots.json) or a source that fails a check is reported, and its shot is not packed.
 */
async function packShots(root: string, usage: ShotUsage, list: ShotList, catalog: AssetCatalog): Promise<ShotPacking> {
  const needs = new Map<BgId, ChapterNeed[]>();
  for (const [ch, c] of Object.entries(usage.chapters) as [ChapterId, ShotUsage['chapters'][ChapterId]][]) {
    for (const [s, need] of Object.entries(c.shots) as [BgId, ShotNeed][]) {
      needs.set(s, [...(needs.get(s) ?? []), { ch, need }]);
    }
  }
  const shots = new Map<BgId, PackedShot>();
  const problems: string[] = [];
  const refused = new Set<BgId>();
  const warnings: string[] = [];
  const rasters = new Map<AssetId, RasterJob>();
  const svgFiles = new Map<AssetId, PackedFile>();
  // R8 reads each chapter's world once; a world that does not decode is one problem, whichever shots it draws.
  const worlds = new Map<ChapterId, WorldSource | null>();
  const world = (ch: ChapterId): WorldSource | null => {
    if (!worlds.has(ch)) {
      const rel = `story/${ch}/world.json`;
      const raw = existsSync(path.join(root, ...rel.split('/'))) ? readJson(root, rel) : null;
      const decoded = raw?.ok === true ? decodeWorldSource(raw.value) : null;
      if (raw?.ok === false) {
        problems.push(raw.why);
      } else if (decoded?.ok === false) {
        problems.push(...decoded.error.map((i) => `${rel}: ${issueText(i)}`));
      }
      worlds.set(ch, decoded?.ok === true ? decoded.value : null);
    }
    return worlds.get(ch) ?? null;
  };
  for (const [s, ns] of [...needs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const first = ns[0]?.need;
    const shot = list.shots.find((x) => x.id === s) ?? (first === undefined ? undefined : { id: s, loc: first.loc, frame: first.frame, cast: [] });
    const bg = Object.hasOwn(catalog.bg, s) ? catalog.bg[s] : undefined;
    const stale = faceNeedProblems(s, ns, catalog);
    if (stale.length > 0) {
      problems.push(...stale);
      refused.add(s);
    } else if (shot !== undefined && bg !== undefined && 'src' in bg) {
      const r = await srcShot(root, shot, bg.src, ns, world);
      if (r.ok) {
        shots.set(s, r.value.packed);
        warnings.push(...r.value.warnings);
        for (const [id, job] of r.value.rasters) {
          rasters.set(id, job);
        }
      } else {
        problems.push(...r.error);
        refused.add(s);
      }
    } else if (shot !== undefined) {
      const layers = placeholderLayers(shot, facesOf(ns.map((n) => n.need)), catalog, CANONICAL_SIZE.bg);
      const pack = packShot(layers);
      shots.set(s, { shot, layers, pack, depth: null });
      for (const [id, f] of pack.files) {
        svgFiles.set(id, f);
      }
    }
  }
  return { shots, problems, refused, warnings, rasters, svgFiles };
}

/**
 * A `src` loop prop's atlas (shots §4.4, cut rider R-b) from `assets/src/<src>/`: every PNG there an 8-bit PNG (D5) by
 * its header, the frames checked (`loopFrameProblems`), then packed from their sizes; each frame's fill is its file,
 * decoded only when the atlas is encoded (`loopRaster`). Every problem is returned by name, nothing thrown.
 */
async function srcLoop(root: string, atlas: AssetId, src: string): Promise<Result<PackedFile<string>, string[]>> {
  const dir = path.join(root, 'assets', 'src', ...src.split('/'));
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.png')).sort() : [];
  const sizes = new Map<string, { readonly w: number; readonly h: number }>();
  const formats: string[] = [];
  for (const name of names) {
    const f = await imageFacts(readFileSync(path.join(dir, name)));
    if (f === null || f.format !== 'png' || f.depth !== 'uchar') {
      formats.push(`${atlas}: assets/src/${src}/${name}: ${f === null ? 'not an image' : `${f.format}, ${f.depth}`}, not an 8-bit PNG (D5)`);
    } else {
      sizes.set(name, { w: f.w, h: f.h });
    }
  }
  const problems = formats.length > 0 ? formats : loopFrameProblems(atlas, src, sizes);
  if (problems.length > 0) {
    return { ok: false, error: problems };
  }
  const frames = Array.from({ length: sizes.size }, (_, i) => {
    const size = sizes.get(`${i}.png`);
    if (size === undefined) {
      throw new Error(`invariant: ${atlas}'s frames are 0.png .. ${sizes.size - 1}.png (loopFrameProblems)`);
    }
    return { ...size, fill: path.join(dir, `${i}.png`) };
  });
  return { ok: true, value: srcLoopAtlas(atlas, frames) };
}

/** A `src` loop atlas as RGBA px: each frame's file decoded and drawn at its box (one atlas at a time). */
async function loopRaster(file: PackedFile<string>): Promise<Raster> {
  const items = await Promise.all(file.items.map(async (it) => ({ ...it, fill: await decodeRaster(readFileSync(it.fill)) })));
  return shotFileRaster({ ...file, items });
}

/**
 * The shipped bytes of an alpha file against its source px, both tiers, AVIF and WebP (R6, D9): the tool's own check,
 * whatever the `Encoders` seam did between (RULINGS 267 keeps it beside the search).
 */
async function shippedAlphaProblems(id: AssetId, px: Raster, image: EncodedImage): Promise<string[]> {
  const tiers: [string, Raster, { readonly avif: Uint8Array; readonly webp: Uint8Array }][] = [['full', px, image]];
  if (image.half !== undefined) {
    tiers.push(['half', { data: halfRgba(px.data, px.w, px.h), w: px.w / 2, h: px.h / 2 }, image.half]);
  }
  const problems: string[] = [];
  for (const [tier, source, files] of tiers) {
    for (const [format, bytes] of [['AVIF', files.avif], ['WebP', files.webp]] as const) {
      problems.push(...alphaProblems(`${id} ${tier} ${format}`, await decodeRaster(bytes), source));
    }
  }
  return problems;
}

/**
 * Per chapter of build/shots.json, what its manifest carries (shots §4.5, CH D5): a rig per shot it shows, cut to the
 * expressions and talk it needs, on its depth grid (a placeholder shot's: the placeholder grid), and its look.
 */
function chapterShotKeys(usage: ShotUsage, shots: ReadonlyMap<BgId, PackedShot>): Map<string, ChapterShotKeys> {
  const placeholder = placeholderDepth();
  const out = new Map<string, ChapterShotKeys>();
  for (const [ch, c] of Object.entries(usage.chapters)) {
    const rigs = (Object.entries(c.shots) as [BgId, ShotNeed][])
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([s, need]) => {
        const packed = shots.get(s);
        if (packed === undefined) {
          throw new Error(`invariant: ${s}, shown by ${ch}, is packed`);
        }
        return [s, shotRig(packed.layers, packed.pack, need, packed.depth ?? placeholder)] as const;
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
export async function main(argv: readonly string[], root: string, encoders: Encoders = { encodeImage, synthWav, encodeRaster }): Promise<number> {
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
  // Shots §4.1 (cut D14): a bg's `src` form names its shot's source directory, extracted below; its cast and needs come
  // from the shot list, so without one the tool names it and stops rather than encode anything in its place.
  const hasShotList = existsSync(path.join(root, ...SHOTS_FILE.split('/')));
  for (const [id, bg] of Object.entries(source?.bg ?? {})) {
    if ('src' in bg && !hasShotList) {
      problems.push(`bg/${id}: src ${bg.src} needs ${SHOTS_FILE} (a src shot's cast and needs come from the shot list)`);
    }
  }
  // Shots §2.4 (W10): a loop prop's frames are one atlas `prop/<id>`; a placeholder's is synthesized here, a src one
  // packed from its frame files (§4.4, cut rider R-b) and encoded from px like a shot file, its q searched from 50.
  const loops = new Map<AssetId, { readonly atlas: PackedFile<unknown>; readonly fps: number }>();
  const loopSvgs = new Map<AssetId, PackedFile>();
  const loopRasters = new Map<AssetId, RasterJob>();
  for (const [id, prop] of Object.entries(source?.prop ?? {})) {
    const atlas = `prop/${id}` as AssetId; // a catalog prop id
    if (!('loop' in prop)) {
      continue;
    }
    if ('src' in prop.loop) {
      const r = await srcLoop(root, atlas, prop.loop.src);
      if (r.ok) {
        const file = r.value;
        loops.set(atlas, { atlas: file, fps: prop.loop.fps });
        loopRasters.set(atlas, { px: () => loopRaster(file), q: DEFAULT_Q, search: true });
      } else {
        problems.push(...r.error);
      }
    } else {
      const file = loopAtlas(atlas, prop.loop.placeholder.hue, prop.loop.placeholder.frames);
      loops.set(atlas, { atlas: file, fps: prop.loop.fps });
      loopSvgs.set(atlas, file);
    }
  }
  // Shots §2.4: with a shot list, the effective catalog (an implied placeholder bg per declared shot it lacks, SH2's
  // cut Q7) and build/shots.json, which the story tool writes beside usage.json; without one, today's path exactly.
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
    shotList !== null && shotUsage !== null && catalog !== null
      ? await packShots(root, shotUsage, shotList, catalog)
      : { shots: new Map(), problems: [], refused: new Set(), warnings: [], rasters: new Map(), svgFiles: new Map() };
  const { shots } = packing;
  problems.push(...packing.problems);
  // R8 is a warning (cut D6): printed whatever the run's outcome, never an exit code.
  for (const w of packing.warnings) {
    console.log(`assets: warning: ${w}`);
  }
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
  // A used `src` bg is a shot's plate, so some shot of build/shots.json shows it; else that file is stale (critique W1).
  const unshown = [...tiers.value].flatMap(([id, tier]) => {
    const name = id.slice(id.indexOf('/') + 1) as BgId; // a bg id's one other segment
    const bg = id.startsWith('bg/') && Object.hasOwn(catalog.bg, name) ? catalog.bg[name] : undefined;
    return tier !== 'unused' && bg !== undefined && 'src' in bg && !packing.rasters.has(id)
      ? [`${id}: src ${bg.src} is used, but ${SHOT_USAGE_FILE} shows no shot of it (run the story tool)`]
      : [];
  });
  if (unshown.length > 0) {
    for (const p of unshown) {
      console.error(`assets: ${p}`);
    }
    return 1;
  }
  // 2. Encode every shipped asset, one at a time: the peak is one decoded canvas (beside the `src` shots' extracted
  // layers, which their packed files are drawn from). A raster's R6 problems are input errors, reported in step 3.
  const encoded = new Map<AssetId, Encoded>();
  const rasterProblems: string[] = [];
  const qLog: string[] = [];
  const toRaster = encoders.encodeRaster ?? encodeRaster;
  for (const [id, tier] of tiers.value) {
    if (tier === 'unused') {
      console.log(`asset unused: ${id}`);
      continue;
    }
    const image = catalogImage(catalog, id);
    const audio = catalogAudio(catalog, id);
    const raster = packing.rasters.get(id) ?? loopRasters.get(id);
    const packed = packing.svgFiles.get(id) ?? loopSvgs.get(id);
    if (raster !== undefined) {
      // A `src` shot's plate (opaque: its q exactly), its packed file or a `src` loop atlas (RULINGS 267: its AVIF q
      // searched against R6), then the tool's own R6 on the shipped bytes; never trimmed, its half pair like any bg (§4.4).
      // A gated one carries its id (fix3 I1): its px may be a public file's (a copy of the rest, a reused source
      // directory), its bytes never are (I-0, scan-dist's hash arm).
      const px = await raster.px();
      const r = await toRaster(px, { id, half: halfAsk(id, tier), q: raster.q, search: raster.search, mark: tier === 'paid' });
      if (!r.ok) {
        rasterProblems.push(...r.error);
        continue;
      }
      if (raster.search) {
        rasterProblems.push(...(await shippedAlphaProblems(id, px, r.value.image)));
        const { full, half } = r.value.q;
        const moved = [full === raster.q ? '' : `${full} full`, half === null || half === raster.q ? '' : `${half} half`].filter((t) => t !== '');
        if (moved.length > 0) {
          qLog.push(`assets: ${id}: AVIF q ${moved.join(', ')} (R6 search from q ${raster.q})`);
        }
      }
      encoded.set(id, { kind: 'image', ...r.value.image });
    } else if (packed !== undefined) {
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
  // so are a shot's plate (R5) and its cast's masks (R9), shots §4.3, and a raster's R6 (its search's ceiling, the
  // tool's own check of the shipped bytes).
  const shotChecks = [...shots].flatMap(([s, { shot, layers }]) => {
    const plate = encoded.get(`bg/${s}` as AssetId); // the shot's plate is its bg, encoded above when a chapter uses it
    return [...(plate?.kind === 'image' ? plateProblems(s, shot.frame, plate.w, plate.h) : []), ...castProblems(layers)];
  });
  const canvases = [...rasterProblems, ...canvasProblems(encoded), ...shotChecks];
  if (canvases.length > 0) {
    for (const p of canvases) {
      console.error(`assets: ${p}`);
    }
    return 1;
  }
  // 4. Plan, check, sweep, write. Principle 0 at the file level (fix3 I-0): a gated file with a public file's bytes is
  // reported by name and nothing is swept or written (a kind without its own mark reaches this from owner input).
  const plan = planAssets({
    chapters,
    usage,
    tiers: tiers.value,
    encoded,
    ...(shotUsage === null ? {} : { shots: chapterShotKeys(shotUsage, shots) }),
    loops: new Map([...loops].map(([id, l]) => [id, loopRig(l.atlas, l.fps)])),
  });
  const copies = gatedCopies(plan.files);
  if (copies.length > 0) {
    for (const p of copies) {
      console.error(`assets: ${p}`);
    }
    return 1;
  }
  const swept = [...stale(root, ASSET_OUT.public, plan.files), ...stale(root, ASSET_OUT.paid, plan.files)];
  for (const rel of swept) {
    rmSync(path.join(root, ...rel.split('/')), { recursive: true, force: true });
  }
  for (const [rel, bytes] of plan.files) {
    const abs = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
  }
  for (const line of qLog) {
    console.log(line);
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
