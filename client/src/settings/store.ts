// The player's settings and the read-sets, cached in Telegram CloudStorage (PROTOTYPE-PLAN K13). A cache, never a
// source of truth (principle 1): a forged value can change a preference or let skip pass an unread line, nothing
// else. Only the four settings are kept and written back, and nothing here is ever asked whether something is owned.
// Every write is best effort (the facade answers ok even when Telegram did not store the value), so nothing waits on
// one. A copy that could not be read is never written over in that session. No timers: the caller flushes the
// read-sets (L15: at autosave points, on `deactivated`, at a chapter's END).
import type { Volumes } from '../audio/manager.ts';
import type { Lang } from '../i18n/index.ts';
import type { ChapterId, LineId } from '../story/staging.ts';
import type { TelegramClient } from '../telegram/index.ts';
import type { TextSpeed } from '../ui/typewriter.ts';

/** The player's settings; `lang` null follows the account's language (K29: the caller maps it). */
export type Settings = Readonly<{ lang: Lang | null; speed: TextSpeed; volume: Readonly<Volumes>; skipUnread: boolean }>;
/** The facade's CloudStorage: the store's one port. */
export type CloudPort = TelegramClient['cloud'];

/** The settings without a cloud copy; the volumes are the AudioManager's start gains. */
export const DEFAULT_SETTINGS: Settings = Object.freeze({
  lang: null,
  speed: 'normal',
  volume: Object.freeze({ master: 100, bgm: 100, sfx: 100 }),
  skipUnread: false,
});
/** The CloudStorage key of the settings value. */
export const SETTINGS_KEY = 'settings';
/** CloudStorage's value limit (core.telegram.org/bots/webapps#cloudstorage); telegram/webapp.ts keeps its copy private. */
export const CLOUD_VALUE_MAX = 4096;
/** One read-set chunk: 750 hashes = 3000 bytes = exactly 4000 base64 characters, without padding. */
export const READ_CHUNK_CHARS = 4000;
/** Chunks per chapter: 6000 lines, at most 8 of a user's 1024 keys, and the count in the head stays one digit. */
export const READ_CHUNKS_MAX = 8;

const SETTINGS_VERSION = 1;
const SPEEDS: readonly TextSpeed[] = ['slow', 'normal', 'fast', 'instant'];
const VOLUME_MAX = 100;
const HASH_BYTES = 4;
/** Hashes per chunk: 4 base64 characters carry 3 bytes. */
const CHUNK_HASHES = ((READ_CHUNK_CHARS / 4) * 3) / HASH_BYTES;
/** Hashes a chapter keeps in the cloud; marks past it stay in memory. */
const READ_HASHES_MAX = CHUNK_HASHES * READ_CHUNKS_MAX;
/** Chunk 0: the format `1`, the chunk count, then the first chunk's hashes. */
const READ_HEAD = /^1\.([0-9])\.(.*)$/s;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** FNV-1a 32 over the UTF-16 code units; a line ID is ASCII (STAGING-DSL §4), so these are its bytes. */
export function fnv1a32(lineId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < lineId.length; i++) {
    h = Math.imul(h ^ lineId.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** The CloudStorage key of a read-set chunk: `read_ch1`, then `read_ch1_1` … (`[A-Za-z0-9_]`, as Telegram allows). */
export function readKey(ch: ChapterId, chunk: number): string {
  return chunk === 0 ? `read_${ch}` : `read_${ch}_${chunk}`;
}

/** The settings in a cloud value, field by field: an invalid field takes its default, an unknown one is dropped. */
export function decodeSettings(raw: string | null): Settings {
  if (raw === null || raw === '') {
    return DEFAULT_SETTINGS;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  return isRecord(parsed) && parsed.v === SETTINGS_VERSION ? settingsOf(parsed) : DEFAULT_SETTINGS;
}

/** The settings and read-set cache of one page. */
export interface SettingsStore {
  /** One get. A missing, malformed or newer-format value gives the defaults; so does an error, with no write after it. */
  load(): Promise<Settings>;
  current(): Settings;
  /**
   * Normalized through the decoder. One write in flight, the latest wins; settles after the write that carries `next`
   * (at once before a successful load: that write follows the load). Never rejects; a failed write is not an error.
   */
  update(next: Settings): Promise<void>;
  /** Merges the cloud copy before the marks made meanwhile. After an error the chapter stays memory-only. */
  loadRead(ch: ChapterId): Promise<void>;
  isRead(ch: ChapterId, line: LineId): boolean;
  /** Memory only; marks the chapter for the next flush. */
  markRead(ch: ChapterId, line: LineId): void;
  /** Writes each changed read-set that was loaded; one flush at a time; never rejects. */
  flush(): Promise<void>;
}

/** One chapter's read-set: the hashes in first-marked order (append-only) and the set of them. */
type ReadSet = {
  order: number[];
  seen: Set<number>;
  status: 'unread' | 'loading' | 'loaded' | 'failed';
  loading: Promise<void>;
  dirty: boolean;
};

export function createSettingsStore(deps: { cloud: CloudPort }): SettingsStore {
  const { cloud } = deps;
  let settings = DEFAULT_SETTINGS;
  /** The cloud copy was read (null included), so a write cannot clobber a copy this session never saw. */
  let loaded = false;
  /** An update ran: a load then keeps it instead of the older cloud copy. */
  let touched = false;
  let settingsDirty = false;
  let writing = false;
  let written: Promise<void> = Promise.resolve();
  const readSets = new Map<ChapterId, ReadSet>();
  let flushWanted = false;
  let flushing = false;
  let flushed: Promise<void> = Promise.resolve();

  function writeSettings(): Promise<void> {
    settingsDirty = true;
    if (!writing) {
      writing = true;
      written = drainSettings();
    }
    return written;
  }

  async function drainSettings(): Promise<void> {
    try {
      while (settingsDirty) {
        settingsDirty = false;
        await cloud.set(SETTINGS_KEY, encodeSettings(settings));
      }
    } finally {
      writing = false;
    }
  }

  function readSetOf(ch: ChapterId): ReadSet {
    let set = readSets.get(ch);
    if (set === undefined) {
      set = { order: [], seen: new Set(), status: 'unread', loading: Promise.resolve(), dirty: false };
      readSets.set(ch, set);
    }
    return set;
  }

  /** Every hash of the chapter's cloud copy in order, or null when a chunk could not be read. */
  async function readChunks(ch: ChapterId): Promise<number[] | null> {
    const head = await cloud.get(readKey(ch, 0));
    if (!head.ok) {
      return null;
    }
    const m = head.value === null ? null : READ_HEAD.exec(head.value);
    const count = m === null ? 0 : Number(m[1]);
    const first = m === null ? null : decodeHashes(m[2] ?? '');
    if (first === null || count < 1 || count > READ_CHUNKS_MAX) {
      return []; // nothing, or a malformed head: an empty set
    }
    const rest = await Promise.all(Array.from({ length: count - 1 }, (_, i) => cloud.get(readKey(ch, i + 1))));
    const out = [...first];
    for (const chunk of rest) {
      if (!chunk.ok) {
        return null; // an unread chunk may hold marks: the chapter is never written over
      }
      out.push(...((chunk.value === null ? null : decodeHashes(chunk.value)) ?? [])); // missing or malformed: skipped
    }
    return out;
  }

  async function writeReadSet(ch: ChapterId, set: ReadSet): Promise<void> {
    set.dirty = false;
    const kept = set.order.slice(0, READ_HASHES_MAX);
    const count = Math.max(1, Math.ceil(kept.length / CHUNK_HASHES));
    // The last chunks first and chunk 0 last: an interrupted write leaves the old head over chunks it already knew.
    for (let i = count - 1; i >= 0; i--) {
      const body = encodeHashes(kept.slice(i * CHUNK_HASHES, (i + 1) * CHUNK_HASHES));
      const done = await cloud.set(readKey(ch, i), i === 0 ? `1.${count}.${body}` : body);
      if (!done.ok) {
        set.dirty = true; // the next flush tries again; no head goes out over a chunk that was not written
        return;
      }
    }
  }

  async function drainReadSets(): Promise<void> {
    try {
      while (flushWanted) {
        flushWanted = false;
        for (const [ch, set] of readSets) {
          if (set.status === 'loaded' && set.dirty) {
            await writeReadSet(ch, set);
          }
        }
      }
    } finally {
      flushing = false;
    }
  }

  /** Adds `h` to the set; reports whether it is a new mark the cloud copy can still hold. */
  function add(set: ReadSet, h: number): boolean {
    if (set.seen.has(h)) {
      return false;
    }
    set.seen.add(h);
    set.order.push(h);
    return set.order.length <= READ_HASHES_MAX;
  }

  return {
    async load() {
      const got = await cloud.get(SETTINGS_KEY);
      if (!got.ok) {
        return settings;
      }
      loaded = true;
      if (touched) {
        // A choice made while the get was in flight is newer than the cloud copy; best effort, nobody waits on it.
        void writeSettings();
        return settings;
      }
      settings = decodeSettings(got.value);
      return settings;
    },
    current: () => settings,
    update(next) {
      settings = settingsOf(next);
      touched = true;
      return loaded ? writeSettings() : Promise.resolve();
    },
    loadRead(ch) {
      const set = readSetOf(ch);
      if (set.status !== 'unread') {
        return set.loading;
      }
      set.status = 'loading';
      set.loading = readChunks(ch).then((persisted) => {
        if (persisted === null) {
          set.status = 'failed';
          return;
        }
        const meanwhile = set.order;
        set.order = [];
        set.seen = new Set();
        persisted.forEach((h) => add(set, h));
        set.dirty = meanwhile.map((h) => add(set, h)).some(Boolean);
        set.status = 'loaded';
      });
      return set.loading;
    },
    isRead: (ch, line) => readSets.get(ch)?.seen.has(fnv1a32(line)) ?? false,
    markRead(ch, line) {
      const set = readSetOf(ch);
      if (add(set, fnv1a32(line))) {
        set.dirty = true;
      }
    },
    flush() {
      flushWanted = true;
      if (!flushing) {
        flushing = true;
        flushed = drainReadSets();
      }
      return flushed;
    },
  };
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function settingsOf(o: Readonly<Record<string, unknown>>): Settings {
  const volume = isRecord(o.volume) ? o.volume : {};
  return Object.freeze({
    lang: o.lang === 'ru' || o.lang === 'en' ? o.lang : DEFAULT_SETTINGS.lang,
    speed: SPEEDS.find((s) => s === o.speed) ?? DEFAULT_SETTINGS.speed,
    volume: Object.freeze({
      master: busOf(volume.master, DEFAULT_SETTINGS.volume.master),
      bgm: busOf(volume.bgm, DEFAULT_SETTINGS.volume.bgm),
      sfx: busOf(volume.sfx, DEFAULT_SETTINGS.volume.sfx),
    }),
    skipUnread: typeof o.skipUnread === 'boolean' ? o.skipUnread : DEFAULT_SETTINGS.skipUnread,
  });
}

function busOf(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(VOLUME_MAX, Math.max(0, Math.round(v))) : fallback;
}

/** The four settings and the format version, nothing else. */
function encodeSettings(s: Settings): string {
  const { master, bgm, sfx } = s.volume;
  return JSON.stringify({ v: SETTINGS_VERSION, lang: s.lang, speed: s.speed, volume: { master, bgm, sfx }, skipUnread: s.skipUnread });
}

/** Hashes as 4 bytes each, big-endian, in base64. */
function encodeHashes(hashes: readonly number[]): string {
  let bytes = '';
  for (const h of hashes) {
    bytes += String.fromCharCode(h >>> 24, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  }
  return btoa(bytes);
}

/** The hashes of one chunk, or null for a value that is not one. */
function decodeHashes(b64: string): number[] | null {
  if (!BASE64.test(b64)) {
    return null;
  }
  const bytes = atob(b64);
  if (bytes.length % HASH_BYTES !== 0 || bytes.length > CHUNK_HASHES * HASH_BYTES) {
    return null;
  }
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += HASH_BYTES) {
    out.push(
      ((bytes.charCodeAt(i) << 24) | (bytes.charCodeAt(i + 1) << 16) | (bytes.charCodeAt(i + 2) << 8) | bytes.charCodeAt(i + 3)) >>>
        0,
    );
  }
  return out;
}
