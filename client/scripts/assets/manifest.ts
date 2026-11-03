// The asset tool's planner (PROTOTYPE-PLAN "Build outputs", "Asset pipeline"; PUZZLES-PLAN, STORIES-PLAN Y15): tiers,
// file names, the per-chapter manifests, the Home covers and the paid file fingerprints, as a plan (repo-relative
// posix path → bytes). Pure: the encoders' results come in, IO stays in assets.ts, sharp is never loaded here.
// Also the one door through which budget.ts, assets.ts and scan-dist.ts reach the src/ decoders: a main module's
// relative imports stay under scripts/ (emit.ts, the `--preserve-symlinks-main` CLI tests).
import { createHash } from 'node:crypto';

import { ASSET_ID_RE, CHAR_HALF_CANVAS_H, TRIMMED_NAMESPACES, decodeAssetManifest } from '../../src/story/catalog.ts';
import type {
  AssetCatalog,
  AssetEntry,
  CatalogAudio,
  CatalogImage,
  ChapterListEntry,
  CoverManifest,
  HalfFile,
  ImageEntry,
  Result,
  SizeTier,
  Trim,
} from '../../src/story/catalog.ts';
import type { AssetId, ChapterId } from '../../src/story/staging.ts';
import { decodeWorldSource } from '../../src/world/decode.ts';
import type { StoryUsage } from '../story/emit.ts';
import type { EncodedHalf, HalfAsk } from './encode.ts';
import { imageKind } from './placeholder.ts';

export {
  TRIMMED_NAMESPACES,
  decodeAssetCatalog,
  decodeAssetManifest,
  decodeChapterMeta,
  decodeCoverManifest,
} from '../../src/story/catalog.ts';
/** The registry's preload cap: the knot-set and room-set rows' limit (MEMORY-PLAN M2). */
export { STEADY_CAP_BYTES } from '../../src/scene/registry.ts';

/** Output locations, repo-relative posix. Paid files never go under `client/` (principle 0). */
export const ASSET_OUT = {
  /** Encoded files of assets any free chapter uses, and every cover: vite copies them to dist/assets/. */
  public: 'client/public/assets',
  /** Encoded files of assets only paid chapters use: served by /api/assets/ after an entitlement check. */
  paid: 'server/content/assets',
  /** `<ch>.assets.json` of a free chapter. */
  free: 'client/src/story-gen/free',
  /** `<ch>/assets.json` of a paid chapter. */
  paidChapters: 'server/content/chapters',
  covers: 'client/src/story-gen/covers.json',
  fingerprints: 'server/content/build/fingerprints.assets.json',
} as const;

const PUBLIC_URL = '/assets/';
const GATED_URL = '/api/assets/';
/** The server's gated file-name rule (server/src/content.rs `gated_asset_type`); every name this tool makes fits it. */
export const ASSET_FILE_RE = /^[a-z0-9][a-z0-9_-]*\.(?:avif|webp|m4a|wav)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------------------------------------------
// Usage: what each chapter names. One adapter builds it, so tiering and budget read one shape.

/** `<ch>/<section>/<room>` (PUZZLES-PLAN "Build outputs"). */
export type RoomKey = string;
/** A room's images (PUZZLES-PLAN `budget/room-set`); `neighbours` are the neighbour rooms' bg ids. */
export type RoomUsage = {
  bg: AssetId;
  props: readonly AssetId[];
  closeups: readonly AssetId[];
  neighbours: readonly AssetId[];
};
export type AssetUsage = {
  chapters: Readonly<Record<ChapterId, { ink: readonly AssetId[]; world: readonly AssetId[] }>>;
  rooms: Readonly<Record<RoomKey, RoomUsage>>;
};

/**
 * The asset usage of a decoded usage.json: a chapter's `worldAssets` and the top-level `rooms`, which the story tool
 * writes only for a chapter with a world (LW3, D4). A pre-LW3 usage.json has neither: no world art, no rooms.
 */
export function assetUsage(u: StoryUsage): AssetUsage {
  const chapters: Record<string, { ink: readonly AssetId[]; world: readonly AssetId[] }> = {};
  for (const [ch, c] of Object.entries(u.chapters)) {
    chapters[ch] = { ink: c.assets, world: c.worldAssets ?? [] };
  }
  return { chapters: chapters as AssetUsage['chapters'], rooms: u.rooms ?? {} }; // keys are usage.json's chapter ids
}

/**
 * Whether a `story/<ch>/world.json` source has sections (budget's room-set rule: a sectioned world needs usage.json
 * `rooms` for its chapter); its decode issues otherwise.
 */
export function worldHasSections(raw: unknown): Result<boolean, string[]> {
  const world = decodeWorldSource(raw);
  if (!world.ok) {
    return { ok: false, error: world.error.map((i) => `${i.path}: ${i.detail}`) };
  }
  return { ok: true, value: Object.keys(world.value.sections).length > 0 };
}

/** Every asset a chapter names (ink ∪ world), sorted, once each. */
export function chapterAssets(usage: AssetUsage, ch: ChapterId): AssetId[] {
  const c = usage.chapters[ch];
  return c === undefined ? [] : [...new Set([...c.ink, ...c.world])].sort();
}

export type Tier = 'public' | 'paid' | 'unused';

/**
 * PROTOTYPE-PLAN "Build outputs": an asset any free chapter uses is public; one only paid chapters use is paid; one
 * no chapter uses is unused (never encoded, never shipped). A cover is public whatever the usage (Home shows it before
 * any purchase, STORIES-PLAN Y15).
 */
export function tierOf(id: AssetId, usage: AssetUsage, chapters: readonly ChapterListEntry[]): Tier {
  if (id.startsWith('cover/')) {
    return 'public';
  }
  const users = chapters.filter((c) => chapterAssets(usage, c.id).includes(id));
  if (users.some((c) => !c.paid)) {
    return 'public';
  }
  return users.length > 0 ? 'paid' : 'unused';
}

/**
 * MEMORY-PLAN 4.C: which half the asset tool asks the encoder for. Public scene images only: a gated half waits for
 * M3s (the server indexes no half), and a cover is drawn by Home, never by the registry. A char's half only on the
 * canonical canvas (the character canvas rule); the encoder sees the clamped canvas, so the ask is a height, not a yes.
 */
export function halfAsk(id: AssetId, tier: Tier): HalfAsk {
  const kind = imageKind(id);
  if (tier !== 'public' || kind === null) {
    return 'none';
  }
  switch (kind) {
    case 'bg':
    case 'cg':
    case 'prop':
      return 'any';
    case 'char':
      return { canvasH: CHAR_HALF_CANVAS_H };
    case 'cover':
      return 'none';
    default: {
      const unhandled: never = kind;
      throw new Error(`invariant: unhandled image kind ${String(unhandled)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The catalog, by asset id

/** Every asset id the catalog defines, sorted. */
export function catalogIds(c: AssetCatalog): AssetId[] {
  const ids: string[] = [];
  const add = (ns: string, names: Iterable<string>): void => {
    for (const name of names) {
      ids.push(`${ns}/${name}`);
    }
  };
  add('bg', Object.keys(c.bg));
  for (const [char, v] of Object.entries(c.chars)) {
    add(`char/${char}`, Object.keys(v.exprs));
  }
  add('cg', Object.keys(c.cg));
  add('bgm', Object.keys(c.bgm));
  add('sfx', Object.keys(c.sfx));
  add('prop', Object.keys(c.prop));
  add('cover', Object.keys(c.cover));
  return ids.sort() as AssetId[]; // every key passed the catalog decoder's id rule
}

function own<T>(record: Readonly<Record<string, T>>, key: string | undefined): T | undefined {
  return key !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The catalog entry of an image id (own properties only), or undefined. */
export function catalogImage(c: AssetCatalog, id: AssetId): CatalogImage | undefined {
  const [ns, a, b] = id.split('/');
  switch (ns) {
    case 'bg':
      return own(c.bg, a);
    case 'cg':
      return own(c.cg, a);
    case 'prop':
      return own(c.prop, a);
    case 'cover':
      return own(c.cover, a);
    case 'char': {
      const char = own(c.chars, a);
      return char === undefined ? undefined : own(char.exprs, b);
    }
    default:
      return undefined;
  }
}

/** The catalog entry of an audio id (own properties only), or undefined. */
export function catalogAudio(c: AssetCatalog, id: AssetId): CatalogAudio | undefined {
  const [ns, a] = id.split('/');
  return ns === 'bgm' ? own(c.bgm, a) : ns === 'sfx' ? own(c.sfx, a) : undefined;
}

/**
 * Every catalog id's tier. Errors: a listed chapter usage.json lacks (or the reverse: the story tool's output is stale)
 * and a used id the catalog does not define.
 */
export function tierAll(
  catalog: AssetCatalog,
  usage: AssetUsage,
  chapters: readonly ChapterListEntry[],
): Result<ReadonlyMap<AssetId, Tier>, string[]> {
  const issues: string[] = [];
  const listed = new Set<string>(chapters.map((c) => c.id));
  for (const c of chapters.filter((ch) => usage.chapters[ch.id] === undefined)) {
    issues.push(`server/content/build/usage.json has no chapter ${c.id} (run the story tool)`);
  }
  for (const ch of Object.keys(usage.chapters).filter((id) => !listed.has(id))) {
    issues.push(`server/content/build/usage.json names ${ch}, which story/chapters.json does not list (run the story tool)`);
  }
  const known = new Set<string>(catalogIds(catalog));
  for (const c of chapters) {
    for (const id of chapterAssets(usage, c.id).filter((a) => !known.has(a))) {
      issues.push(`${c.id} uses ${id}, which assets/catalog.json does not define`);
    }
  }
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  return { ok: true, value: new Map(catalogIds(catalog).map((id) => [id, tierOf(id, usage, chapters)])) };
}

// ---------------------------------------------------------------------------------------------------------------
// The plan

/**
 * An encoded asset: an image as AVIF + WebP with sharp's dimensions (and a char or prop's trim, and the half pair when
 * the encoder made one), or a clip as WAV.
 */
export type Encoded =
  | { kind: 'image'; avif: Uint8Array; webp: Uint8Array; w: number; h: number; trim?: Trim; half?: EncodedHalf }
  | { kind: 'audio'; role: 'bgm' | 'sfx'; wav: Uint8Array; durationMs: number };

/**
 * MEMORY-PLAN 4.B, input errors of the encoded char and prop images: per character, one canvas for all expressions
 * (a swap keeps one transform); every canvas with even sides (an even trimmed box always fits it). Messages, empty
 * when fine; the asset tool checks them before planning.
 */
export function canvasProblems(encoded: ReadonlyMap<AssetId, Encoded>): string[] {
  const problems: string[] = [];
  const perChar = new Map<string, Array<readonly [AssetId, string]>>();
  for (const [id, enc] of [...encoded].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [ns, name] = id.split('/');
    if (enc.kind !== 'image' || ns === undefined || !TRIMMED_NAMESPACES.includes(ns)) {
      continue;
    }
    const w = enc.trim?.canvasW ?? enc.w;
    const h = enc.trim?.canvasH ?? enc.h;
    if (w % 2 !== 0 || h % 2 !== 0) {
      problems.push(`${id}: canvas ${w}×${h} has an odd side (char and prop canvases are even)`);
    }
    if (ns === 'char') {
      const key = `char/${name ?? ''}`;
      perChar.set(key, [...(perChar.get(key) ?? []), [id, `${w}×${h}`] as const]);
    }
  }
  for (const [char, canvases] of perChar) {
    if (new Set(canvases.map(([, c]) => c)).size > 1) {
      problems.push(`${char}: expressions on different canvases (${canvases.map(([id, c]) => `${id} ${c}`).join(', ')})`);
    }
  }
  return problems;
}

/** server/content/build/fingerprints.assets.json: one entry per paid file, sorted by name. */
export type AssetFingerprint = { asset: AssetId; name: string; sha256: string };
export type AssetFingerprints = { files: readonly AssetFingerprint[] };

export type AssetPlan = {
  files: ReadonlyMap<string, Uint8Array>;
  summary: { public: AssetId[]; paid: AssetId[]; unused: AssetId[]; covers: AssetId[] };
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * `<ns>-<id parts joined by ->[-half]-<hash8>.<ext>`, inside the server's name rule. Injective: ids never hold '-' and
 * each namespace has a fixed number of parts (char 3, every other 2), so a half name has one segment more than its full
 * name and its first segment still names its namespace.
 */
export function assetFileName(id: AssetId, bytes: Uint8Array, ext: 'avif' | 'webp' | 'wav', size: SizeTier): string {
  return `${id.replaceAll('/', '-')}${size === 'half' ? '-half' : ''}-${sha256Hex(bytes).slice(0, 8)}.${ext}`;
}

/** The repo-relative file a manifest URL names, or null for a URL outside both prefixes. */
export function urlPath(url: string): string | null {
  if (url.startsWith(GATED_URL)) {
    return `${ASSET_OUT.paid}/${url.slice(GATED_URL.length)}`;
  }
  if (url.startsWith(PUBLIC_URL)) {
    return `${ASSET_OUT.public}/${url.slice(PUBLIC_URL.length)}`;
  }
  return null;
}

function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function sortedRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  return Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The full output plan of the asset tool for tiers from `tierAll` and every non-unused asset encoded. Throws on a bug:
 * a paid file planned under client/, a free chapter's manifest holding an /api/ URL, a planned manifest its own
 * decoder refuses. Deterministic for the same inputs and bytes.
 */
export function planAssets(input: {
  chapters: readonly ChapterListEntry[];
  usage: AssetUsage;
  tiers: ReadonlyMap<AssetId, Tier>;
  encoded: ReadonlyMap<AssetId, Encoded>;
}): AssetPlan {
  const files = new Map<string, Uint8Array>();
  const put = (path: string, bytes: Uint8Array): void => {
    if (files.has(path)) {
      throw new Error(`invariant: one producer per output, ${path} planned twice`);
    }
    files.set(path, bytes);
  };
  const entries = new Map<AssetId, AssetEntry>();
  const fingerprints: AssetFingerprint[] = [];
  const summary: AssetPlan['summary'] = { public: [], paid: [], unused: [], covers: [] };
  for (const [id, tier] of [...input.tiers].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (tier === 'unused') {
      summary.unused.push(id);
      continue;
    }
    (id.startsWith('cover/') ? summary.covers : summary[tier]).push(id);
    const enc = input.encoded.get(id);
    if (enc === undefined) {
      throw new Error(`invariant: ${id} (${tier}) is encoded before planning`);
    }
    if ((enc.kind === 'image') !== (imageKind(id) !== null)) {
      throw new Error(`invariant: ${id} is encoded as its namespace's kind`);
    }
    const dir = tier === 'paid' ? ASSET_OUT.paid : ASSET_OUT.public;
    const urlPrefix = tier === 'paid' ? GATED_URL : PUBLIC_URL;
    const file = (bytes: Uint8Array, ext: 'avif' | 'webp' | 'wav', size: SizeTier = 'full'): { url: string; bytes: number } => {
      const name = assetFileName(id, bytes, ext, size);
      const path = `${dir}/${name}`;
      if (tier === 'paid' && (path.startsWith('client/') || urlPrefix !== GATED_URL)) {
        throw new Error(`invariant: paid-only ${id} is never planned under client/ (principle 0)`);
      }
      put(path, bytes);
      if (tier === 'paid') {
        fingerprints.push({ asset: id, name, sha256: sha256Hex(bytes) });
      }
      return { url: `${urlPrefix}${name}`, bytes: bytes.length };
    };
    // MEMORY-PLAN 4.C, the tier gate: a half only for a public scene image (a gated half waits for M3s, which serves
    // it; a cover is never drawn by the registry), whatever the encoder returned. Its files sit beside the full ones.
    const halfOf = (h: EncodedHalf | undefined): HalfFile | undefined =>
      h === undefined || tier !== 'public' || id.startsWith('cover/')
        ? undefined
        : { w: h.w, h: h.h, decodedBytes: h.w * h.h * 4, avif: file(h.avif, 'avif', 'half'), webp: file(h.webp, 'webp', 'half') };
    // An image's w, h and decodedBytes are its stored px; a trimmed file's trim follows webp (MEMORY-PLAN §5).
    if (enc.kind === 'image') {
      const avif = file(enc.avif, 'avif');
      const webp = file(enc.webp, 'webp');
      const half = halfOf(enc.half);
      entries.set(id, {
        kind: 'image',
        w: enc.w,
        h: enc.h,
        decodedBytes: enc.w * enc.h * 4,
        avif,
        webp,
        ...(enc.trim === undefined ? {} : { trim: enc.trim }),
        ...(half === undefined ? {} : { half }),
      });
    } else {
      entries.set(id, { kind: 'audio', role: enc.role, durationMs: enc.durationMs, file: file(enc.wav, 'wav'), codec: 'wav' });
    }
  }
  for (const ch of input.chapters) {
    const assets = sortedRecord(
      chapterAssets(input.usage, ch.id).map((id) => {
        const entry = entries.get(id);
        if (entry === undefined) {
          throw new Error(`invariant: ${id}, used by ${ch.id}, has a tier and an entry`);
        }
        return [id, entry] as const;
      }),
    );
    const manifest = { chapterId: ch.id, assets };
    const text = JSON.stringify(manifest);
    if (!ch.paid && text.includes(`"${GATED_URL}`)) {
      throw new Error(`invariant: free chapter ${ch.id}'s manifest holds no /api/ URL (principle 0)`);
    }
    const decoded = decodeAssetManifest(JSON.parse(text));
    if (!decoded.ok) {
      throw new Error(`invariant: the planned ${ch.id} manifest decodes: ${JSON.stringify(decoded.error)}`);
    }
    put(ch.paid ? `${ASSET_OUT.paidChapters}/${ch.id}/assets.json` : `${ASSET_OUT.free}/${ch.id}.assets.json`, json(manifest));
  }
  const covers: CoverManifest['assets'] = sortedRecord(
    summary.covers.flatMap((id): Array<readonly [string, ImageEntry]> => {
      const entry = entries.get(id);
      return entry?.kind === 'image' ? [[id, entry]] : [];
    }),
  );
  put(ASSET_OUT.covers, json({ assets: covers }));
  fingerprints.sort((a, b) => (a.name < b.name ? -1 : 1));
  put(ASSET_OUT.fingerprints, json({ files: fingerprints }));
  return { files, summary };
}

// ---------------------------------------------------------------------------------------------------------------
// fingerprints.assets.json's decoder: the producer exports the consumer's decoder (scan-dist), as emit.ts does for
// the line fingerprints.

type Raw = Readonly<Record<string, unknown>>;

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function keysExactly(v: Raw, keys: readonly string[], path: string, issues: string[]): void {
  for (const k of Object.keys(v).filter((x) => !keys.includes(x))) {
    issues.push(`${path}${k}: unknown key (expected ${keys.join(', ')})`);
  }
  for (const k of keys.filter((x) => !Object.hasOwn(v, x))) {
    issues.push(`${path}${k}: missing`);
  }
}

/** Decodes fingerprints.assets.json: `{ files: [{ asset, name, sha256 }] }`, names unique; every problem reported. */
export function decodeAssetFingerprints(raw: unknown): Result<AssetFingerprints, string[]> {
  const issues: string[] = [];
  if (!isObject(raw)) {
    return { ok: false, error: ['not a JSON object'] };
  }
  keysExactly(raw, ['files'], '', issues);
  const list = raw['files'];
  const files: AssetFingerprint[] = [];
  if (!Array.isArray(list)) {
    issues.push('files: not an array');
  } else {
    list.forEach((entry: unknown, i) => {
      const path = `files.${i}`;
      if (!isObject(entry)) {
        issues.push(`${path}: not an object`);
        return;
      }
      keysExactly(entry, ['asset', 'name', 'sha256'], `${path}.`, issues);
      const { asset, name, sha256 } = entry;
      const ok = (value: unknown, re: RegExp, key: string): value is string => {
        if (typeof value === 'string' && re.test(value)) {
          return true;
        }
        issues.push(`${path}.${key}: ${JSON.stringify(value) ?? 'undefined'} does not match ${re.source}`);
        return false;
      };
      const good = [ok(asset, ASSET_ID_RE, 'asset'), ok(name, ASSET_FILE_RE, 'name'), ok(sha256, SHA256_RE, 'sha256')];
      if (files.some((f) => f.name === name)) {
        issues.push(`${path}.name: duplicate ${JSON.stringify(name)}`);
      }
      if (good.every(Boolean)) {
        // The brand is earned by ASSET_ID_RE above; the strings were checked by `ok`.
        files.push({ asset: asset as AssetId, name: name as string, sha256: sha256 as string });
      }
    });
  }
  if (issues.length > 0) {
    return { ok: false, error: issues };
  }
  return { ok: true, value: { files } };
}
