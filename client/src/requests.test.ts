// @vitest-environment node
// The request walk (engine plan §8.1 point 11; RULINGS 148, 152, 233): every request start under `client/src` is a
// declared site, and every wait of the views on one names the hold that covers it. One `ts.Program` from
// `client/tsconfig.json` with its checker walks every `.ts` file under `client/src` but tests, declarations,
// `api/generated/**` and `story-gen/**`, so a new directory is walked with no author step; `.svelte` scripts are parsed
// and checked by name only (the checker does not read them). A start is a reference to a port member (by its
// declaration, so a `Pick` keeps it), a value typed by the asset transport, an `import()` (or a lazy
// `import.meta.glob`), or a network start of the lib; how its promise is consumed does not matter. The guarded members
// (the ports', the batch member, the scene's loads; the transport by type) may not be re-typed or widened at a value
// flow, and the views' host may hold no promise-returning member without its row. Reads every file, edits none.
import { parse } from 'svelte/compiler';
import ts from 'typescript';
import { expect, test } from 'vitest';

/** One `ts.Program` over the tree takes seconds; each test of this file may take up to this long. */
const WALK_TIMEOUT_MS = 60_000;

const slash = (p: string): string => p.replace(/\\/g, '/');
/** A `file:` URL's path (`/D:/x` on Windows is `D:/x`): no node built-in, so `npm run check` needs no node types. */
const pathOf = (u: URL): string => {
  const p = decodeURIComponent(u.pathname);
  return /^\/[A-Za-z]:\//.test(p) ? p.slice(1) : p;
};
const CLIENT = pathOf(new URL('..', import.meta.url)).replace(/\/$/, '');
const SRC = `${CLIENT}/src`;
/** The self-tests' fixture sources: in the program, outside `client/src`, so the tree's walk never reads them. */
const FIXTURE = `${CLIENT}/requests-fixture`;

// ---------------------------------------------------------------------------------------------------------------
// The tables (engine plan §8.1 point 11)

/** The ports whose members start a request. An exported object type of `api/**` (not `generated/`) with a member
 *  returning a `Promise` that is not listed fails ("unlisted port"). */
const REQUEST_PORTS = [
  { file: 'api/endpoints.ts', port: 'Endpoints' },
  { file: 'api/meta.ts', port: 'MetaEndpoints' },
  { file: 'api/http.ts', port: 'Http', members: ['auth', 'request', 'fetchAsset'] },
] as const satisfies readonly { readonly file: string; readonly port: string; readonly members?: readonly string[] }[];

/** The asset transport: a value-position reference whose type is this alias's (identity after `getNonNullableType`)
 *  and that is no port member reference is a start, member `'FetchAsset'`. */
const TRANSPORT = { file: 'story/catalog.ts', alias: 'FetchAsset' } as const;

/** "This member only inside that site": every reference to `member` (by its declaration in `member.file`, through a
 *  property access, a string-keyed element access, an object binding element, a value hand-off) in any walked file
 *  lies inside the one function-like declaration with a body in `site.file` with a parameter whose declared type names
 *  `site.alias`, and there is exactly one such reference program-wide. */
type SiteMember = {
  readonly label: string;
  readonly member: { readonly file: string; readonly type: string; readonly name: string };
  readonly site: { readonly file: string; readonly alias: string };
};
/** The one batch member: every batch of the views goes through `heldBy`'s `held` (§8.1 "The frame's flags"). */
const BATCH_MEMBER = {
  label: 'batch',
  member: { file: 'app/yields.ts', type: 'YieldsHost', name: 'apply' },
  site: { file: 'app/yields.ts', alias: 'HeldAt' },
} as const satisfies SiteMember;
const SITE_MEMBERS = [BATCH_MEMBER] as const satisfies readonly SiteMember[];

/** The views' host, whose promise-returning members (at any depth, by declaration in `client/src`'s `.ts` files) each
 *  need a row naming the wait that covers them. */
const HOST_ROOT = { file: 'app/yields.ts', type: 'YieldsHost' } as const;
const HOST_WAITS = [
  { member: 'YieldsHost.apply', wait: 'batch' }, // held's (BATCH_MEMBER)
  { member: 'YieldsHost.continueStory', wait: 'story' }, // the story path's step
  { member: 'YieldsHost.tap', wait: 'intent' }, // D7: completes a batch
  { member: 'YieldsHost.queue', wait: 'intent' }, // after the batch in flight
  { member: 'LazyChunks.explore', wait: 'import()' }, // a request row's
  { member: 'LazyChunks.puzzleHost', wait: 'import()' },
  { member: 'LazyChunks.puzzleUi', wait: 'import()' },
  { member: 'LazyChunks.cueStage', wait: 'import()' }, // RULINGS 233 Q1: the ninth
  { member: 'HintPort.use', wait: 'ladder' }, // through `hints()`
] as const satisfies readonly { member: string; wait: 'batch' | 'story' | 'intent' | 'import()' | 'ladder' }[];

/** The lib's network starts: a declaration of one of these names in a default lib file. */
const LIB_STARTS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon'] as const;

/** Point 11's rows. yields.test.ts keeps `WAIT_CASES: { readonly [R in WaitRow]: WaitCase }` (a type-only import). */
const WAIT_ROWS = ['batch', 'explore-import', 'frame-chunks', 'answer', 'ladder'] as const;
export type WaitRow = (typeof WAIT_ROWS)[number];
/** A view row never names `batch`, whose completeness is the batch member's alone. */
type ViewWait = Exclude<WaitRow, 'batch'>;
type Member = `${(typeof REQUEST_PORTS)[number]['port']}.${string}` | 'FetchAsset' | 'import()' | (typeof LIB_STARTS)[number];
type SiteRow =
  | { readonly kind: 'view'; readonly file: string; readonly fn: string; readonly member: Member; readonly waits: readonly [ViewWait, ...ViewWait[]] }
  | { readonly kind: 'other'; readonly file: string; readonly fn: string; readonly member: Member; readonly reason: string }
  | { readonly kind: 'port'; readonly file: string; readonly within: string; readonly reason: string };

const REQUEST_SITES: readonly SiteRow[] = [
  // The views' waits: each row names the holds that cover it (its `WAIT_CASES` case proves them).
  { kind: 'view', file: 'app/yields.ts', fn: 'explore', member: 'import()', waits: ['explore-import'] },
  { kind: 'view', file: 'app/yields.ts', fn: 'puzzleHost', member: 'import()', waits: ['frame-chunks'] },
  { kind: 'view', file: 'app/yields.ts', fn: 'cueStage', member: 'import()', waits: ['explore-import', 'frame-chunks'] },
  { kind: 'view', file: 'puzzles/registry.ts', fn: '<module>', member: 'import()', waits: ['frame-chunks'] },
  { kind: 'view', file: 'puzzles/session.ts', fn: 'attempt', member: 'Endpoints.postAttempt', waits: ['answer'] },
  { kind: 'view', file: 'puzzles/session.ts', fn: '#fetchStatus', member: 'Endpoints.getPuzzle', waits: ['ladder'] },
  { kind: 'view', file: 'meta/wallet.ts', fn: 'use', member: 'MetaEndpoints.useHint', waits: ['ladder'] },
  { kind: 'view', file: 'app/game.ts', fn: 'getPuzzle', member: 'Endpoints.getPuzzle', waits: ['ladder'] },
  { kind: 'view', file: 'app/game.ts', fn: 'postAttempt', member: 'Endpoints.postAttempt', waits: ['answer'] },
  // The ports' own implementations: every start inside the factory is the port's member itself.
  { kind: 'port', file: 'api/endpoints.ts', within: 'createEndpoints', reason: 'the Endpoints port: each method is its member over Http.request' },
  { kind: 'port', file: 'api/meta.ts', within: 'createMetaEndpoints', reason: 'the MetaEndpoints port: each method is its member over Http.request' },
  { kind: 'port', file: 'api/http.ts', within: 'createHttp', reason: 'the Http port: the one fetch seam and the transport it returns' },
  // Boot and Home: before a story view exists; Home's own loading states.
  { kind: 'other', file: 'main.ts', fn: 'boot', member: 'import()', reason: 'dev/e2e only: the mock transport under __TG_MOCK__, compiled out of production' },
  { kind: 'other', file: 'app/boot.ts', fn: 'fetchJson', member: 'Http.fetchAsset', reason: "boot's public JSON reads (catalog, covers): before any story view" },
  { kind: 'other', file: 'app/boot.ts', fn: 'evidence', member: 'Http.fetchAsset', reason: "LBI's recovery probe (health, a chunk key): the boot latch's, no view" },
  { kind: 'other', file: 'app/boot.ts', fn: 'load', member: 'import()', reason: "the meta controller's chunk: Home's meta gate, no story view" },
  { kind: 'other', file: 'app/boot.ts', fn: 'stats', member: 'Endpoints.getStats', reason: "the meta controller's stats read: Home's cards" },
  { kind: 'other', file: 'app/boot.ts', fn: 'refresh', member: 'Endpoints.getEntitlements', reason: 'the entitlements refresh: Home and the paywall, no story view' },
  { kind: 'other', file: 'app/boot.ts', fn: 'readAll', member: 'Http.auth', reason: "boot's required reads: the boot screen's, before any story view" },
  { kind: 'other', file: 'app/boot.ts', fn: 'readAll', member: 'Endpoints.listSaves', reason: "boot's required reads: the boot screen's, before any story view" },
  { kind: 'other', file: 'app/boot.ts', fn: 'readAll', member: 'Endpoints.getEntitlements', reason: "boot's reads: the boot screen's, before any story view" },
  { kind: 'other', file: 'app/boot.ts', fn: 'importEngine', member: 'import()', reason: "the engine chunk: Home's start of a story, before its views exist" },
  { kind: 'other', file: 'app/boot.ts', fn: 'saveList', member: 'Endpoints.listSaves', reason: "Home's save list: Home's own state" },
  { kind: 'other', file: 'app/boot.ts', fn: 'refreshHome', member: 'Endpoints.listSaves', reason: "Home's refresh on return: Home's own state" },
  { kind: 'other', file: 'app/boot.ts', fn: 'boot', member: 'Endpoints.getStats', reason: "the stats read handed to the meta gate at boot: Home's cards" },
  // The meta controller and its services: Home's screens and sheets, no story view.
  { kind: 'other', file: 'app/meta.ts', fn: 'loadUi', member: 'import()', reason: "the meta UI chunk: Home's sheets" },
  { kind: 'other', file: 'app/meta.ts', fn: 'loadPurchase', member: 'import()', reason: "the purchase chunk from Home's shop: the meta controller's state" },
  { kind: 'other', file: 'app/meta.ts', fn: 'gift', member: 'MetaEndpoints.postGift', reason: "a gift from the friends sheet: the sheet's own state" },
  { kind: 'other', file: 'meta/card.ts', fn: 'load', member: 'MetaEndpoints.postCard', reason: "Home's story card: the card's own state" },
  { kind: 'other', file: 'meta/wallet.ts', fn: 'refresh', member: 'MetaEndpoints.getWallet', reason: 'the wallet sync: its readers show the last balance, nothing waits' },
  { kind: 'other', file: 'meta/social.ts', fn: 'refresh', member: 'MetaEndpoints.getSocial', reason: "the friends sheet's list: the sheet's own state" },
  { kind: 'other', file: 'meta/social.ts', fn: 'accept', member: 'MetaEndpoints.acceptFriend', reason: "the friends sheet's action: the sheet's own state" },
  { kind: 'other', file: 'meta/social.ts', fn: 'remove', member: 'MetaEndpoints.removeFriend', reason: "the friends sheet's action: the sheet's own state" },
  { kind: 'other', file: 'meta/social.ts', fn: 'rotate', member: 'MetaEndpoints.rotateInvite', reason: "the friends sheet's action: the sheet's own state" },
  { kind: 'other', file: 'meta/social.ts', fn: 'setVisible', member: 'MetaEndpoints.putConsent', reason: "the friends sheet's consent: the sheet's own state" },
  { kind: 'other', file: 'meta/social.ts', fn: 'profile', member: 'MetaEndpoints.getFriendProfile', reason: "a friend's profile: the sheet's own state" },
  { kind: 'other', file: 'meta/social.ts', fn: 'invite', member: 'MetaEndpoints.getInvite', reason: "the invite link: the sheet's own state" },
  { kind: 'other', file: 'meta/social.ts', fn: 'ask', member: 'MetaEndpoints.askInvite', reason: "an invite answer: the prompt's own state" },
  { kind: 'other', file: 'meta/social.ts', fn: 'prepareShare', member: 'MetaEndpoints.postShare', reason: "a share message: Telegram's share sheet, no view" },
  // The purchase flow: the Stars sheet and the paywall's own states.
  { kind: 'other', file: 'purchase/flow.ts', fn: 'chapterDelivered', member: 'Endpoints.getEntitlements', reason: "the delivery poll after a payment: the paywall's state" },
  { kind: 'other', file: 'purchase/flow.ts', fn: 'poll', member: 'Endpoints.getOrder', reason: "the order poll: the paywall's state" },
  { kind: 'other', file: 'purchase/flow.ts', fn: 'buy', member: 'Endpoints.createInvoice', reason: "the invoice: the Stars sheet's, the paywall's state" },
  // GameSession's own loads and hand-offs: the story path, the menus, the scene's mount.
  { kind: 'other', file: 'app/game.ts', fn: 'loadPurchase', member: 'import()', reason: "the purchase chunk: the paywall's own loading" },
  { kind: 'other', file: 'app/game.ts', fn: 'loadOverlayUi', member: 'import()', reason: "lever O5's overlays chunk: an overlay open waits on it in GameSession (RULINGS 228-231), no yields view" },
  { kind: 'other', file: 'app/game.ts', fn: 'chapterFailed', member: 'FetchAsset', reason: "LBI's build probe after a failed chapter: nothing waits" },
  { kind: 'other', file: 'app/game.ts', fn: 'mountOnce', member: 'FetchAsset', reason: "the transport handed to the scene's mount: the image loader's" },
  { kind: 'other', file: 'app/game.ts', fn: 'refreshSlots', member: 'Endpoints.listSaves', reason: "the save screen's slot list (F3): a menu overlay's state" },
  { kind: 'other', file: 'app/engine.ts', fn: 'createEngine', member: 'Http.fetchAsset', reason: 'the transport taken from the port for the engine: a hand-off' },
  { kind: 'other', file: 'app/engine.ts', fn: 'createEngine', member: 'FetchAsset', reason: 'the transport handed to GameSession: a hand-off' },
  { kind: 'other', file: 'app/engine.ts', fn: 'getChapter', member: 'Endpoints.getChapter', reason: "a paid chapter's JSON: the story path's wait (continueStory), no view's" },
  { kind: 'other', file: 'app/engine.ts', fn: 'loader', member: 'FetchAsset', reason: 'the transport handed to the chapter loader: a hand-off' },
  { kind: 'other', file: 'app/engine.ts', fn: 'audio', member: 'FetchAsset', reason: 'the transport handed to the audio manager: a hand-off' },
  { kind: 'other', file: 'story/chapters.ts', fn: 'fetchJson', member: 'FetchAsset', reason: "a chapter file: the story path's wait (continueStory), no view's" },
  { kind: 'other', file: 'scene/controller.ts', fn: 'mount', member: 'FetchAsset', reason: 'the transport handed to the image loader: a hand-off' },
  { kind: 'other', file: 'scene/loader.ts', fn: 'createImageLoader', member: 'FetchAsset', reason: "the scene's image fetch: a view waits on it only as a batch's loads, through held (BATCH_MEMBER)" },
  { kind: 'other', file: 'scene/loader.ts', fn: 'upgrade', member: 'FetchAsset', reason: "a preview's full file (shots §5.8 step 3): nothing waits, the half stays live" },
  { kind: 'other', file: 'audio/manager.ts', fn: 'createAudioManager', member: 'FetchAsset', reason: 'the transport handed to the BGM player: a hand-off' },
  { kind: 'other', file: 'audio/bgm.ts', fn: 'take', member: 'FetchAsset', reason: 'a gated track: it plays when it lands, nothing waits' },
  { kind: 'other', file: 'audio/sfx.ts', fn: 'fill', member: 'FetchAsset', reason: 'a one-shot fill: it plays when it lands, nothing waits' },
  // The saves, the stats and the dev mock: nothing in a view waits.
  { kind: 'other', file: 'saves/service.ts', fn: 'send', member: 'Endpoints.putSave', reason: "the autosave queue's send: fire-and-forget, the queue keeps its result" },
  { kind: 'other', file: 'saves/service.ts', fn: 'manualPut', member: 'Endpoints.putSave', reason: "a manual save (F3): the save screen's state" },
  { kind: 'other', file: 'saves/service.ts', fn: 'uploadPending', member: 'Endpoints.putSave', reason: 'the pending autosave upload: background, nothing waits' },
  { kind: 'other', file: 'saves/service.ts', fn: 'autosave', member: 'Endpoints.putSave', reason: 'the keepalive autosave at a close: nothing waits' },
  { kind: 'other', file: 'saves/service.ts', fn: 'load', member: 'Endpoints.getSave', reason: "a slot's load (F3): the save screen's state, before the story restores" },
  { kind: 'other', file: 'stats/reporter.ts', fn: 'send', member: 'Endpoints.postStatEvents', reason: "the stats batch: the reporter's queue, nothing waits" },
  { kind: 'other', file: 'telegram/dev/mock-transport.ts', fn: 'fetch', member: 'fetch', reason: "dev/e2e only: the fake Stars sheet's dev route" },
];

/** Rows whose completeness is not the walk's request table: `batch` is the batch member's. */
const HELD_ROWS: readonly WaitRow[] = ['batch'];
/** The only files that may name `SceneController`'s loading members. */
const SCENE_LOADERS = ['app/game.ts', 'scene/'] as const;
const SCENE_LOADS = { file: 'scene/controller.ts', type: 'SceneController', names: ['ensure', 'apply', 'restore', 'mount'] } as const;
/** A file under these holds view rows only. */
const VIEW_FILES = ['app/yields.ts', 'explore/', 'mechanics/', 'puzzles/', 'ui/explore/', 'ui/puzzles/'] as const;
/** Names a `.svelte` script may not hold (components are presentational). */
const COMPONENT_BANNED = ['YieldsHost', 'SceneController', 'Endpoints', 'MetaEndpoints', 'Http', 'FetchAsset', 'fetchAsset'] as const;

// ---------------------------------------------------------------------------------------------------------------
// The program

/** The self-tests' sources, by name under `FIXTURE`. */
const FIXTURES: Readonly<Record<string, string>> = {
  'resolve.ts': `import type { Endpoints } from '../src/api/endpoints.ts';
import type { Http } from '../src/api/http.ts';
import type { YieldsHost } from '../src/app/yields.ts';
import type { FetchAsset } from '../src/story/catalog.ts';

export function viaPick(api: Pick<Endpoints, 'getPuzzle'>): void {
  void api.getPuzzle;
}
export function viaPort(api: Endpoints): void {
  void api.getPuzzle;
}
export function viaHostPick(h: Pick<YieldsHost, 'apply'>): void {
  void h.apply;
}
export function viaHttpPick(http: Pick<Http, 'fetchAsset'>): void {
  void http.fetchAsset;
}
type F = FetchAsset;
export function viaAlias(f: F): void {
  void f;
}
type Structural = { getPuzzle: Endpoints['getPuzzle'] };
export function retyped(api: Endpoints): Structural {
  return api;
}
export function picked(api: Endpoints): Pick<Endpoints, 'getPuzzle'> {
  return api;
}
export function frozen(api: Endpoints): Readonly<Endpoints> {
  return Object.freeze(api);
}
function constrained<D extends { apply: YieldsHost['apply'] }>(d: D): D {
  return d;
}
export function intoConstraint(h: YieldsHost): void {
  void constrained(h);
}
function unconstrained<D>(d: D): D {
  return d;
}
export function intoParameter(h: YieldsHost): void {
  void unconstrained(h);
}
export function intoUnknown(h: YieldsHost): void {
  const x: unknown = h;
  void x;
}
export function intoObject(h: YieldsHost): void {
  const x: object = h;
  void x;
}
export function intoEmpty(h: YieldsHost): void {
  const x: {} = h;
  void x;
}
`,
  'host.ts': `import type { YieldsHost } from '../src/app/yields.ts';

export interface FixtureHost extends YieldsHost {
  warm(ids: readonly string[]): Promise<void>;
}
`,
  'site.ts': `export type FixtureAt = { readonly n: number };
export type FixturePort = { touch(n: number): void };

export function held(p: FixturePort, at: FixtureAt): void {
  p.touch(at.n);
}
export const other = {
  held(p: FixturePort): void {
    p.touch(3);
  },
};
export function elsewhere(p: FixturePort): void {
  p.touch(1);
}
`,
};

type Program = { readonly program: ts.Program; readonly checker: ts.TypeChecker };
let built: Program | null = null;

/** The tree's program (every non-test `.ts` of `client/src` as a root) with the fixture sources; built once. */
function program(): Program {
  if (built !== null) {
    return built;
  }
  const config = ts.readConfigFile(`${CLIENT}/tsconfig.json`, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, CLIENT);
  const fixtures = new Map(Object.entries(FIXTURES).map(([name, text]) => [`${FIXTURE}/${name}`, text]));
  const host = ts.createCompilerHost(parsed.options, true);
  const base = { fileExists: host.fileExists, readFile: host.readFile, getSourceFile: host.getSourceFile };
  host.fileExists = (f) => fixtures.has(slash(f)) || base.fileExists(f);
  host.readFile = (f) => fixtures.get(slash(f)) ?? base.readFile(f);
  host.getSourceFile = (f, lang, onError, fresh) => {
    const text = fixtures.get(slash(f));
    return text === undefined ? base.getSourceFile(f, lang, onError, fresh) : ts.createSourceFile(f, text, lang, true);
  };
  const roots = [...parsed.fileNames.filter((f) => !f.endsWith('.test.ts')), ...fixtures.keys()];
  const p = ts.createProgram({ rootNames: roots, options: parsed.options, host });
  built = { program: p, checker: p.getTypeChecker() };
  return built;
}

/** A source file's name as the tables write it: under `client/src`, or `requests-fixture/<name>`; null elsewhere. */
function relOf(sf: ts.SourceFile): string | null {
  const f = slash(sf.fileName);
  const low = f.toLowerCase();
  if (low.startsWith(`${SRC.toLowerCase()}/`)) {
    return f.slice(SRC.length + 1);
  }
  if (low.startsWith(`${FIXTURE.toLowerCase()}/`)) {
    return `requests-fixture/${f.slice(FIXTURE.length + 1)}`;
  }
  return null;
}

/** The tree's walked files: `client/src`'s `.ts` files but tests, declarations, `api/generated/**`, `story-gen/**`. */
function treeFiles(p: Program): Map<string, ts.SourceFile> {
  const out = new Map<string, ts.SourceFile>();
  for (const sf of p.program.getSourceFiles()) {
    const rel = relOf(sf);
    if (rel === null || rel.startsWith('requests-fixture/') || sf.isDeclarationFile || !rel.endsWith('.ts') || rel.endsWith('.test.ts')) {
      continue;
    }
    if (rel.startsWith('api/generated/') || rel.startsWith('story-gen/')) {
      continue;
    }
    out.set(rel, sf);
  }
  return out;
}

/** The fixture files, by their table name. */
function fixtureFiles(p: Program): Map<string, ts.SourceFile> {
  const out = new Map<string, ts.SourceFile>();
  for (const name of Object.keys(FIXTURES)) {
    const sf = p.program.getSourceFile(`${FIXTURE}/${name}`);
    if (sf === undefined) {
      throw new Error(`invariant: the fixture ${name} is in the program`);
    }
    out.set(`requests-fixture/${name}`, sf);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Names and declarations

/** Every node under `node`, depth first. */
function each(node: ts.Node, visit: (n: ts.Node) => void): void {
  const go = (n: ts.Node): void => {
    visit(n);
    ts.forEachChild(n, go);
  };
  go(node);
}

/** The name of a function-like node, by 08a's `fn` rule; null when it is anonymous (a call's argument, an IIFE). */
function ownName(f: ts.Node): string | null {
  if (ts.isFunctionDeclaration(f)) {
    return f.name?.text ?? null;
  }
  if (ts.isMethodDeclaration(f) || ts.isGetAccessorDeclaration(f) || ts.isSetAccessorDeclaration(f)) {
    return ts.isIdentifier(f.name) || ts.isPrivateIdentifier(f.name) || ts.isStringLiteral(f.name) ? f.name.text : null;
  }
  if (ts.isConstructorDeclaration(f)) {
    return 'constructor';
  }
  if (!ts.isArrowFunction(f) && !ts.isFunctionExpression(f)) {
    return null;
  }
  // Named by the variable, property or class field whose initializer holds it with no function in between.
  let n: ts.Node = f;
  for (;;) {
    const parent = n.parent;
    const transparent =
      ts.isParenthesizedExpression(parent) ||
      ts.isConditionalExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      (ts.isBinaryExpression(parent) &&
        [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.CommaToken].includes(parent.operatorToken.kind));
    if (!transparent) {
      break;
    }
    n = parent;
  }
  const holder = n.parent;
  if ((ts.isVariableDeclaration(holder) || ts.isPropertyDeclaration(holder)) && holder.initializer === n) {
    return ts.isIdentifier(holder.name) || ts.isPrivateIdentifier(holder.name) ? holder.name.text : null;
  }
  if (ts.isPropertyAssignment(holder) && holder.initializer === n) {
    return ts.isIdentifier(holder.name) || ts.isStringLiteral(holder.name) || ts.isPrivateIdentifier(holder.name) ? holder.name.text : null;
  }
  return f.name?.text ?? null;
}

const isFunctionLike = (n: ts.Node): boolean =>
  ts.isFunctionDeclaration(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isArrowFunction(n) ||
  ts.isFunctionExpression(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n);

/** The nearest enclosing named function of `node` and its node; the top level is `<module>`. */
function fnOf(node: ts.Node): { readonly fn: string; readonly at: ts.Node } {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (isFunctionLike(n)) {
      const name = ownName(n);
      if (name !== null) {
        return { fn: name, at: n };
      }
    }
  }
  return { fn: '<module>', at: node.getSourceFile() };
}

/** The type or interface named `name` declared at the top level of `sf`. */
function typeDecls(sf: ts.SourceFile, name: string): Array<ts.InterfaceDeclaration | ts.TypeAliasDeclaration> {
  return sf.statements.filter((s): s is ts.InterfaceDeclaration | ts.TypeAliasDeclaration => (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name.text === name);
}

/** The declarations of member `name` of the object type `decl` declares. */
function memberDecls(decl: ts.InterfaceDeclaration | ts.TypeAliasDeclaration, name: string): ts.Node[] {
  const members = ts.isInterfaceDeclaration(decl) ? decl.members : ts.isTypeLiteralNode(decl.type) ? decl.type.members : ts.factory.createNodeArray<ts.TypeElement>();
  return members.filter((m) => m.name !== undefined && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) && m.name.text === name);
}

/** The owner of a member declaration: its interface's or type alias's name. */
function ownerOf(decl: ts.Node): string {
  const p = decl.parent;
  if (ts.isInterfaceDeclaration(p) || ts.isClassDeclaration(p)) {
    return p.name?.text ?? '<anonymous>';
  }
  if (ts.isTypeLiteralNode(p) && ts.isTypeAliasDeclaration(p.parent)) {
    return p.parent.name.text;
  }
  return '<anonymous>';
}

/** The member declarations a property symbol names: its declarations (a `Pick`'s mapped symbol keeps the source's). */
function declsOf(sym: ts.Symbol | undefined): readonly ts.Node[] {
  return sym?.declarations ?? [];
}

/** A declaration's file is in the host-wait scope (S1): a non-declaration `.ts` file under `client/src`. */
type Scope = (sf: ts.SourceFile) => boolean;
const inSrc: Scope = (sf) => !sf.isDeclarationFile && sf.fileName.endsWith('.ts') && (relOf(sf)?.startsWith('requests-fixture/') === false);
/** S1 widened by the fixture sources, for the self-tests (and the flows, whose fixture types are followed). */
const inSrcOrFixture: Scope = (sf) => !sf.isDeclarationFile && sf.fileName.endsWith('.ts') && relOf(sf) !== null;

// ---------------------------------------------------------------------------------------------------------------
// The walk

/** What the walk resolves once per program: the guarded declarations and the transport's type. */
type Guards = {
  /** Port member declaration -> `Port.member`. */
  readonly ports: ReadonlyMap<ts.Node, string>;
  /** Every guarded member declaration (the ports', the site members', the scene's loads) -> its name. */
  readonly guarded: ReadonlyMap<ts.Node, string>;
  /** The scene's loading member declarations -> `SceneController.<name>`. */
  readonly scene: ReadonlyMap<ts.Node, string>;
  readonly transport: ts.Type;
  /** Every listed port member's name (a `.svelte` script may name none). */
  readonly requestNames: ReadonlySet<string>;
};

function guardsOf(p: Program, files: ReadonlyMap<string, ts.SourceFile>, siteRows: readonly SiteMember[]): Guards {
  const fileOf = (rel: string): ts.SourceFile => {
    const sf = files.get(rel);
    if (sf === undefined) {
      throw new Error(`invariant: ${rel} is walked`);
    }
    return sf;
  };
  const ports = new Map<ts.Node, string>();
  const requestNames = new Set<string>();
  for (const row of REQUEST_PORTS) {
    for (const decl of typeDecls(fileOf(row.file), row.port)) {
      const type = p.checker.getTypeAtLocation(decl.name);
      for (const prop of p.checker.getPropertiesOfType(type)) {
        if ('members' in row && !(row.members as readonly string[]).includes(prop.name)) {
          continue;
        }
        requestNames.add(prop.name);
        for (const d of declsOf(prop)) {
          ports.set(d, `${row.port}.${prop.name}`);
        }
      }
    }
  }
  const guarded = new Map<ts.Node, string>(ports);
  for (const row of siteRows) {
    for (const decl of typeDecls(fileOf(row.member.file), row.member.type)) {
      for (const d of memberDecls(decl, row.member.name)) {
        guarded.set(d, `${row.member.type}.${row.member.name}`);
      }
    }
  }
  const scene = new Map<ts.Node, string>();
  for (const decl of typeDecls(fileOf(SCENE_LOADS.file), SCENE_LOADS.type)) {
    for (const name of SCENE_LOADS.names) {
      for (const d of memberDecls(decl, name)) {
        scene.set(d, `${SCENE_LOADS.type}.${name}`);
        guarded.set(d, `${SCENE_LOADS.type}.${name}`);
      }
    }
  }
  const alias = typeDecls(fileOf(TRANSPORT.file), TRANSPORT.alias);
  const aliasDecl = alias[0];
  if (alias.length !== 1 || aliasDecl === undefined) {
    throw new Error(`invariant: one ${TRANSPORT.alias} in ${TRANSPORT.file}`);
  }
  const transport = p.checker.getTypeAtLocation(aliasDecl.name);
  return { ports, guarded, scene, transport, requestNames };
}

/** One request start: where, in which named function, of which member. */
type Start = { readonly file: string; readonly fn: string; readonly fnAt: ts.Node; readonly member: string; readonly node: ts.Node };

/** What one walk found. */
type Found = { readonly starts: readonly Start[]; readonly problems: readonly string[] };

const isTypePosition = (node: ts.Node): boolean => {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
      return true;
    }
    if (ts.isStatement(n) || ts.isBlock(n)) {
      return false;
    }
  }
  return false;
};

/** An identifier that names a declaration rather than referencing a value. */
function declaresName(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isShorthandPropertyAssignment(p)) {
    return false; // `{ x }` references x
  }
  return (
    ((ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isBindingElement(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p)) &&
      p.name === id) ||
    (ts.isBindingElement(p) && p.propertyName === id) ||
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isNamespaceImport(p) ||
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    ts.isQualifiedName(p)
  );
}

/** Is `t` (non-null) the transport's type? */
const isTransport = (p: Program, g: Guards, t: ts.Type | undefined): boolean => t !== undefined && p.checker.getNonNullableType(t) === g.transport;

/** The property symbol a reference shape names, or undefined (a property access, a string-keyed access, a binding). */
function referencedProperty(p: Program, node: ts.Node): ts.Symbol | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return p.checker.getSymbolAtLocation(node.name);
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return p.checker.getPropertyOfType(p.checker.getTypeAtLocation(node.expression), node.argumentExpression.text);
  }
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const key = node.propertyName ?? node.name;
    if (ts.isIdentifier(key) || ts.isStringLiteral(key)) {
      return p.checker.getPropertyOfType(p.checker.getTypeAtLocation(node.parent), key.text);
    }
  }
  return undefined;
}

const firstIn = (decls: readonly ts.Node[], map: ReadonlyMap<ts.Node, string>): string | undefined => {
  for (const d of decls) {
    const v = map.get(d);
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
};

/** Whether a value of type `t` exposes a member a computed access could reach in `map` (a port, the host). */
function exposes(p: Program, t: ts.Type, map: ReadonlyMap<ts.Node, string>): string | undefined {
  for (const prop of p.checker.getPropertiesOfType(p.checker.getNonNullableType(t))) {
    const hit = firstIn(declsOf(prop), map);
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
}

/** The request starts and the per-node problems of `files`. */
function walkStarts(p: Program, g: Guards, files: ReadonlyMap<string, ts.SourceFile>, siteRows: readonly SiteMember[]): Found {
  const starts: Start[] = [];
  const problems: string[] = [];
  const siteDecls = new Map<ts.Node, string>();
  for (const [d, name] of g.guarded) {
    if (siteRows.some((r) => name === `${r.member.type}.${r.member.name}`)) {
      siteDecls.set(d, name);
    }
  }
  for (const [file, sf] of files) {
    const start = (node: ts.Node, member: string): void => {
      const f = fnOf(node);
      starts.push({ file, fn: f.fn, fnAt: f.at, member, node });
    };
    const sceneOk = SCENE_LOADERS.some((l) => (l.endsWith('/') ? file.startsWith(l) : file === l));
    each(sf, (node) => {
      // (b) an `import()`, or a lazy `import.meta.glob` (Vite turns it into `import()`s).
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          start(node, 'import()');
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isMetaProperty(node.expression.expression) &&
          node.expression.name.text === 'glob'
        ) {
          const opts = node.arguments[1];
          const eager =
            opts !== undefined &&
            ts.isObjectLiteralExpression(opts) &&
            opts.properties.some((q) => ts.isPropertyAssignment(q) && ts.isIdentifier(q.name) && q.name.text === 'eager' && q.initializer.kind === ts.SyntaxKind.TrueKeyword);
          if (!eager) {
            start(node, 'import()');
          }
        }
        return;
      }
      // A computed access on a port or a site member's owner reaches a member the walk cannot name.
      if (ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression) && !ts.isNumericLiteral(node.argumentExpression)) {
        const t = p.checker.getTypeAtLocation(node.expression);
        if (exposes(p, t, g.ports) !== undefined) {
          problems.push(`computed port access ${file} ${fnOf(node).fn}`);
        }
        const site = exposes(p, t, siteDecls);
        if (site !== undefined) {
          problems.push(`computed ${site.split('.')[0] ?? ''} access ${file} ${fnOf(node).fn}`);
        }
        return;
      }
      // (a) a member reference by declaration; (d) a transport-typed reference that is no port member's.
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent))) {
        if (isTypePosition(node)) {
          return;
        }
        const sym = referencedProperty(p, node);
        const decls = declsOf(sym);
        const port = firstIn(decls, g.ports);
        if (port !== undefined) {
          start(node, port);
        } else if (sym !== undefined && isTransport(p, g, p.checker.getTypeOfSymbol(sym))) {
          start(node, 'FetchAsset');
        }
        const scene = firstIn(decls, g.scene);
        if (scene !== undefined && !sceneOk) {
          problems.push(`scene load outside app/game.ts and scene/ ${file} ${fnOf(node).fn}`);
        }
        // (c) the lib's network starts through a property (`navigator.sendBeacon`, `globalThis.fetch`).
        if (ts.isPropertyAccessExpression(node) && (LIB_STARTS as readonly string[]).includes(node.name.text) && decls.some((d) => p.program.isSourceFileDefaultLibrary(d.getSourceFile()))) {
          start(node, node.name.text);
        }
        return;
      }
      if (ts.isIdentifier(node) && !declaresName(node) && !isTypePosition(node)) {
        const sym = p.checker.getSymbolAtLocation(node);
        if (sym === undefined) {
          return;
        }
        // (c) the lib's network starts.
        if ((LIB_STARTS as readonly string[]).includes(node.text) && declsOf(sym).some((d) => p.program.isSourceFileDefaultLibrary(d.getSourceFile()))) {
          start(node, node.text);
          return;
        }
        // (d) a transport-typed value referenced by name.
        if (isTransport(p, g, p.checker.getTypeOfSymbol(sym))) {
          start(node, 'FetchAsset');
        }
      }
    });
  }
  return { starts, problems };
}

/** Matches the starts to `rows`; every row-level failure. */
function checkRows(starts: readonly Start[], rows: readonly SiteRow[], files: ReadonlyMap<string, ts.SourceFile>): string[] {
  const problems: string[] = [];
  const portFiles = new Set<string>(REQUEST_PORTS.map((r) => r.file));
  const used = new Set<SiteRow>();
  const inViews = (file: string): boolean => VIEW_FILES.some((v) => (v.endsWith('/') ? file.startsWith(v) : file === v));
  // A port row's subtree: the function named `within` in its file.
  const withinOf = (row: Extract<SiteRow, { kind: 'port' }>): ts.Node[] => {
    const sf = files.get(row.file);
    const out: ts.Node[] = [];
    if (sf !== undefined) {
      each(sf, (n) => {
        if (isFunctionLike(n) && ownName(n) === row.within) {
          out.push(n);
        }
      });
    }
    return out;
  };
  const ports = rows.filter((r): r is Extract<SiteRow, { kind: 'port' }> => r.kind === 'port').map((r) => ({ row: r, at: withinOf(r) }));
  const inside = (node: ts.Node, at: readonly ts.Node[]): boolean => {
    for (let n: ts.Node | undefined = node; n !== undefined; n = n.parent) {
      if (at.includes(n)) {
        return true;
      }
    }
    return false;
  };
  for (const s of starts) {
    const port = ports.find((x) => x.row.file === s.file && inside(s.node, x.at));
    if (port !== undefined) {
      used.add(port.row);
      continue;
    }
    const row = rows.find((r) => r.kind !== 'port' && r.file === s.file && r.fn === s.fn && r.member === s.member);
    if (row === undefined) {
      problems.push(`unlisted request start ${s.file} ${s.fn} ${s.member}`);
    } else {
      used.add(row);
    }
  }
  for (const r of rows) {
    if (!used.has(r)) {
      problems.push(r.kind === 'port' ? `stale row ${r.file} ${r.within}` : `stale row ${r.file} ${r.fn} ${r.member}`);
    }
    if (r.kind === 'other' && inViews(r.file)) {
      problems.push(`other row in a views file ${r.file} ${r.fn}`);
    }
    if (r.kind === 'port' && !portFiles.has(r.file)) {
      problems.push(`port row outside its port's file ${r.file} ${r.within}`);
    }
  }
  // Two named functions of one name holding starts in one file.
  const named = new Map<string, Set<ts.Node>>();
  for (const s of starts) {
    const k = `${s.file} ${s.fn}`;
    named.set(k, (named.get(k) ?? new Set()).add(s.fnAt));
  }
  for (const [k, at] of named) {
    if (at.size > 1) {
      problems.push(`ambiguous fn ${k}`);
    }
  }
  // A wait row no view row names, outside the held rows.
  const named2 = new Set(rows.flatMap((r) => (r.kind === 'view' ? r.waits : [])));
  for (const w of WAIT_ROWS) {
    if (!HELD_ROWS.includes(w) && !named2.has(w as ViewWait)) {
      problems.push(`orphan wait row ${w}`);
    }
  }
  return problems;
}

/** An exported object type of `api/**` (not `generated/`) with a promise-returning member that no port row lists. */
function unlistedPorts(p: Program, files: ReadonlyMap<string, ts.SourceFile>): string[] {
  const out: string[] = [];
  for (const [file, sf] of files) {
    if (!file.startsWith('api/') || file.startsWith('api/generated/')) {
      continue;
    }
    for (const s of sf.statements) {
      if (!(ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) || !(ts.getCombinedModifierFlags(s) & ts.ModifierFlags.Export)) {
        continue;
      }
      if (REQUEST_PORTS.some((r) => r.file === file && r.port === s.name.text)) {
        continue;
      }
      const type = p.checker.getTypeAtLocation(s.name);
      if (p.checker.getPropertiesOfType(type).some((prop) => returnsPromise(p, p.checker.getTypeOfSymbol(prop)))) {
        out.push(`unlisted port ${file} ${s.name.text}`);
      }
    }
  }
  return out;
}

/** A function type (or a union holding one) whose call returns a `Promise`. */
function returnsPromise(p: Program, t: ts.Type): boolean {
  const types = p.checker.getNonNullableType(t).isUnion() ? (p.checker.getNonNullableType(t) as ts.UnionType).types : [p.checker.getNonNullableType(t)];
  return types.some((x) => x.getCallSignatures().some((sig) => p.checker.getNonNullableType(sig.getReturnType()).getSymbol()?.name === 'Promise'));
}

// ---------------------------------------------------------------------------------------------------------------
// The site members

/** Every site member row's failures over `files`. */
function checkSiteMembers(p: Program, files: ReadonlyMap<string, ts.SourceFile>, rows: readonly SiteMember[], label = (r: SiteMember): string => r.label): string[] {
  const problems: string[] = [];
  for (const row of rows) {
    const memberFile = files.get(row.member.file);
    const siteFile = files.get(row.site.file);
    if (memberFile === undefined || siteFile === undefined) {
      problems.push(`${label(row)} member or site file not walked`);
      continue;
    }
    const decls = new Set(typeDecls(memberFile, row.member.type).flatMap((d) => memberDecls(d, row.member.name)));
    const aliases = typeDecls(siteFile, row.site.alias).filter(ts.isTypeAliasDeclaration);
    const aliasDecl = aliases[0];
    if (aliases.length !== 1 || aliasDecl === undefined) {
      problems.push(`${label(row)} site ${aliases.length} declarations`);
      continue;
    }
    const alias = p.checker.getSymbolAtLocation(aliasDecl.name);
    // The site: the one function-like declaration with a body in the site's file with a parameter typed by the alias.
    const sites: ts.Node[] = [];
    each(siteFile, (n) => {
      if (!isFunctionLike(n) || (n as ts.FunctionLikeDeclaration).body === undefined) {
        return;
      }
      const named = (n as ts.FunctionLikeDeclaration).parameters.some((param) => {
        let hit = false;
        if (param.type !== undefined) {
          each(param.type, (t) => {
            if (ts.isTypeReferenceNode(t) && p.checker.getSymbolAtLocation(t.typeName) === alias) {
              hit = true;
            }
          });
        }
        return hit;
      });
      if (named) {
        sites.push(n);
      }
    });
    const site = sites[0];
    if (sites.length !== 1 || site === undefined) {
      problems.push(`${label(row)} site ${sites.length} declarations`);
      continue;
    }
    const siteFn = ownName(site) ?? fnOf(site).fn;
    let count = 0;
    for (const [file, sf] of files) {
      each(sf, (node) => {
        if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)))) {
          return;
        }
        if (!declsOf(referencedProperty(p, node)).some((d) => decls.has(d))) {
          return;
        }
        count += 1;
        let inside = false;
        for (let n: ts.Node | undefined = node; n !== undefined; n = n.parent) {
          if (n === site) {
            inside = true;
          }
        }
        if (!inside) {
          problems.push(`${label(row)} outside ${siteFn} ${file} ${fnOf(node).fn}`);
        }
      });
    }
    if (count !== 1) {
      problems.push(`${label(row)} site count ${count}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// The host waits

/**
 * The host-wait reach's bound in types. S1 keeps it small (302 types on the tree at GM3p); a walk past it has lost its
 * scope (a lib generic's method instantiates fresh type parameters at each step, so an unscoped reach never ends), and
 * the bound turns that into a failure line instead of a hang or a stack overflow.
 */
const HOST_REACH_MAX = 3_000;

/** What the host-wait walk found: the members, and whether it stopped at `HOST_REACH_MAX`. */
type Reach = { readonly members: readonly string[]; readonly capped: boolean };

/** Every promise-returning member under `root` (its type's properties, call signatures' returns and union members, at
 *  any depth, breadth first; never parameter types, type arguments or index signatures), by declaration in the scope
 *  (S1), as `Owner.member`; port members excluded. */
function hostWaits(p: Program, root: ts.Type, ports: ReadonlyMap<ts.Node, string>, scope: Scope): Reach {
  const found = new Set<string>();
  const seen = new Set<ts.Type>();
  const queue: ts.Type[] = [root];
  for (let next = 0; next < queue.length; next += 1) {
    const t = p.checker.getNonNullableType(queue[next] as ts.Type);
    if (seen.has(t)) {
      continue;
    }
    if (seen.size === HOST_REACH_MAX) {
      return { members: [...found].sort(), capped: true };
    }
    seen.add(t);
    if (t.isUnion()) {
      queue.push(...t.types);
      continue;
    }
    for (const prop of p.checker.getPropertiesOfType(t)) {
      const decls = declsOf(prop);
      const decl = decls.find((d) => scope(d.getSourceFile()));
      if (decl === undefined || firstIn(decls, ports) !== undefined) {
        continue;
      }
      const pt = p.checker.getTypeOfSymbol(prop);
      if (returnsPromise(p, pt)) {
        found.add(`${ownerOf(decl)}.${prop.name}`);
      }
      queue.push(pt);
    }
    // A function's result: `hints()` reaches `HintPort`.
    for (const sig of t.getCallSignatures()) {
      queue.push(sig.getReturnType());
    }
  }
  return { members: [...found].sort(), capped: false };
}

/** The host type the reach starts from. */
function hostRoot(p: Program, files: ReadonlyMap<string, ts.SourceFile>, file: string, type: string): ts.Type {
  const sf = files.get(file);
  const decl = sf === undefined ? undefined : typeDecls(sf, type)[0];
  if (decl === undefined) {
    throw new Error(`invariant: ${type} in ${file}`);
  }
  return p.checker.getTypeAtLocation(decl.name);
}

/** The host-wait rows' failures for a computed reach. */
function checkHostWaits(reach: Reach, rows: readonly { member: string }[]): string[] {
  const listed = new Set(rows.map((r) => r.member));
  return [
    ...reach.members.filter((m) => !listed.has(m)).map((m) => `unlisted host wait ${m}`),
    ...[...listed].filter((m) => !reach.members.includes(m)).map((m) => `stale host row ${m}`),
    ...(reach.capped ? [`host-wait reach past ${HOST_REACH_MAX} types`] : []),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// The value flows: a guarded member re-typed or widened

/** The flow check over `files`. */
function checkFlows(p: Program, g: Guards, files: ReadonlyMap<string, ts.SourceFile>): string[] {
  const c = p.checker;
  const problems = new Set<string>();
  const nn = (t: ts.Type): ts.Type => c.getNonNullableType(t);
  const guardOf = (sym: ts.Symbol): string | undefined => firstIn(declsOf(sym), g.guarded) ?? (isTransport(p, g, c.getTypeOfSymbol(sym)) ? 'FetchAsset' : undefined);
  /** A property worth following: declared in the scope, or synthetic (a tuple element). */
  const followable = (sym: ts.Symbol): boolean => declsOf(sym).length === 0 || declsOf(sym).some((d) => inSrcOrFixture(d.getSourceFile()));
  const carriesMemo = new Map<ts.Type, boolean>();
  /** The guarded names a value of `t` carries at any depth. */
  const carried = (raw: ts.Type, out: Set<string>, seen = new Set<ts.Type>()): void => {
    const t = nn(raw);
    if (seen.has(t)) {
      return;
    }
    seen.add(t);
    if (t === g.transport) {
      out.add('FetchAsset');
      return;
    }
    if (t.isUnion()) {
      t.types.forEach((x) => carried(x, out, seen));
      return;
    }
    for (const prop of c.getPropertiesOfType(t)) {
      const hit = guardOf(prop);
      if (hit !== undefined) {
        out.add(hit);
      } else if (followable(prop)) {
        carried(c.getTypeOfSymbol(prop), out, seen);
      }
    }
  };
  const carries = (t: ts.Type): boolean => {
    const k = nn(t);
    let v = carriesMemo.get(k);
    if (v === undefined) {
      const out = new Set<string>();
      carried(k, out);
      v = out.size > 0;
      carriesMemo.set(k, v);
    }
    return v;
  };
  const memberless = (t: ts.Type): boolean =>
    (t.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.NonPrimitive)) !== 0 ||
    ((t.flags & ts.TypeFlags.Object) !== 0 &&
      c.getPropertiesOfType(t).length === 0 &&
      t.getCallSignatures().length === 0 &&
      t.getConstructSignatures().length === 0 &&
      c.getIndexInfosOfType(t).length === 0);
  /** S flowing into T at `where`. */
  const compare = (rawS: ts.Type, rawT: ts.Type, where: string, seen: Set<string>): void => {
    const s = nn(rawS);
    let t = nn(rawT);
    if ((t.flags & ts.TypeFlags.Any) !== 0) {
      return; // not followed: what flows out of `any` has no declaration to resolve
    }
    if (t.flags & ts.TypeFlags.TypeParameter) {
      const constraint = c.getBaseConstraintOfType(t);
      if (constraint === undefined || (constraint.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) !== 0 || constraint === t) {
        return;
      }
      t = nn(constraint);
    }
    if (t.isUnion()) {
      t.types.forEach((x) => compare(s, x, where, seen));
      return;
    }
    if (s.isUnion()) {
      s.types.forEach((x) => compare(x, t, where, seen));
      return;
    }
    if (!carries(s)) {
      return;
    }
    if (memberless(t)) {
      const out = new Set<string>();
      carried(s, out);
      for (const name of out) {
        problems.add(`widened ${name} ${where}`);
      }
      return;
    }
    if (s === g.transport) {
      if (t !== g.transport) {
        problems.add(`re-typed FetchAsset ${where}`);
      }
      return;
    }
    const key = `${c.typeToString(s)}=>${c.typeToString(t)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const index = c.getIndexInfosOfType(t).find((i) => (i.keyType.flags & ts.TypeFlags.String) !== 0);
    for (const prop of c.getPropertiesOfType(s)) {
      const hit = guardOf(prop);
      const target = c.getPropertyOfType(t, prop.name);
      if (hit !== undefined) {
        if (target === undefined) {
          if (index !== undefined) {
            problems.add(`re-typed ${hit} ${where}`);
          }
          continue;
        }
        const same = hit === 'FetchAsset' ? isTransport(p, g, c.getTypeOfSymbol(target)) : declsOf(target).some((d) => declsOf(prop).includes(d));
        if (!same) {
          problems.add(`re-typed ${hit} ${where}`);
        }
        continue;
      }
      if (!followable(prop) || !carries(c.getTypeOfSymbol(prop))) {
        continue;
      }
      if (target !== undefined) {
        compare(c.getTypeOfSymbol(prop), c.getTypeOfSymbol(target), where, seen);
      } else if (index !== undefined) {
        compare(c.getTypeOfSymbol(prop), index.type, where, seen);
      }
    }
  };
  const flow = (file: string, source: ts.Expression, target: ts.Type | undefined): void => {
    if (target === undefined) {
      return;
    }
    const s = c.getTypeAtLocation(source);
    if (!carries(s)) {
      return;
    }
    compare(s, target, `${file} ${fnOf(source).fn}`, new Set());
  };
  for (const [file, sf] of files) {
    each(sf, (node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const args = node.arguments ?? ts.factory.createNodeArray<ts.Expression>();
        args.forEach((arg, i) => {
          if (ts.isSpreadElement(arg)) {
            return;
          }
          flow(file, arg, c.getContextualType(arg));
          // A constrained generic: the uninstantiated parameter type, its type parameter replaced by its constraint.
          const decl = c.getResolvedSignature(node)?.getDeclaration();
          const param = decl !== undefined && ts.isFunctionLike(decl) ? decl.parameters[i] : undefined;
          if (param?.type !== undefined && param.dotDotDotToken === undefined) {
            const declared = c.getTypeFromTypeNode(param.type);
            if (declared.flags & ts.TypeFlags.TypeParameter) {
              flow(file, arg, declared);
            }
          }
        });
        return;
      }
      if (ts.isPropertyAssignment(node)) {
        flow(file, node.initializer, c.getContextualType(node.initializer));
      } else if (ts.isShorthandPropertyAssignment(node)) {
        flow(file, node.name, c.getContextualType(node.name));
      } else if (ts.isSpreadAssignment(node)) {
        flow(file, node.expression, c.getContextualType(node.expression));
      } else if (ts.isArrayLiteralExpression(node)) {
        for (const el of node.elements) {
          if (!ts.isSpreadElement(el) && !ts.isOmittedExpression(el)) {
            flow(file, el, c.getContextualType(el));
          }
        }
      } else if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node)) && node.type !== undefined && node.initializer !== undefined) {
        flow(file, node.initializer, c.getTypeFromTypeNode(node.type));
      } else if (ts.isReturnStatement(node) && node.expression !== undefined) {
        const fn = ts.findAncestor(node, (n) => isFunctionLike(n)) as ts.FunctionLikeDeclaration | undefined;
        if (fn?.type !== undefined) {
          flow(file, node.expression, c.getContextualType(node.expression));
        }
      } else if (ts.isArrowFunction(node) && node.type !== undefined && !ts.isBlock(node.body)) {
        flow(file, node.body, c.getContextualType(node.body));
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        flow(file, node.right, c.getTypeAtLocation(node.left));
      } else if ((ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) && !(ts.isTypeReferenceNode(node.type) && node.type.getText() === 'const')) {
        flow(file, node.expression, c.getTypeFromTypeNode(node.type));
      }
    });
  }
  return [...problems];
}

// ---------------------------------------------------------------------------------------------------------------
// The components

/** Every `.svelte` file under `client/src` (Vite's raw import: a new directory is read with no author step). */
const SVELTE_SOURCES = import.meta.glob<string>('./**/*.svelte', { query: '?raw', import: 'default', eager: true });
/** The `.svelte` sources by their path under `client/src`. */
function svelteSources(): Array<[string, string]> {
  return Object.entries(SVELTE_SOURCES)
    .map(([key, source]): [string, string] => [key.slice('./'.length), source])
    .sort(([a], [b]) => a.localeCompare(b));
}

/** In a `.svelte` script: a request member's name, `import(` or a lib start, and a guarded type name. */
function checkComponent(file: string, source: string, requestNames: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const ast = parse(source, { modern: true });
  for (const script of [ast.instance, ast.module]) {
    if (script === null || script === undefined) {
      continue;
    }
    const content = script.content as unknown as { start: number; end: number }; // ESTree positions (acorn)
    const sf = ts.createSourceFile(`${file}.ts`, source.slice(content.start, content.end), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    each(sf, (n) => {
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        out.push(`request in a component ${file} import(`);
      }
      if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) {
        if (requestNames.has(n.text) || (LIB_STARTS as readonly string[]).includes(n.text)) {
          out.push(`request in a component ${file} ${n.text}`);
        }
        if ((COMPONENT_BANNED as readonly string[]).includes(n.text)) {
          out.push(`guarded type in a component ${file} ${n.text}`);
        }
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The tests

/** The program, the tree, the fixtures and the guards: one per file run, shared by the four tests. */
type World = {
  readonly p: Program;
  readonly tree: ReadonlyMap<string, ts.SourceFile>;
  readonly fixtures: ReadonlyMap<string, ts.SourceFile>;
  readonly g: Guards;
};
let world: World | null = null;
function theWorld(): World {
  if (world === null) {
    const p = program();
    const tree = treeFiles(p);
    world = { p, tree, fixtures: fixtureFiles(p), g: guardsOf(p, tree, SITE_MEMBERS) };
  }
  return world;
}
/** One fixture file as a walked set. */
const fixture = (w: World, name: string): Map<string, ts.SourceFile> => {
  const sf = w.fixtures.get(`requests-fixture/${name}`);
  if (sf === undefined) {
    throw new Error(`invariant: the fixture ${name} is in the program`);
  }
  return new Map([[`requests-fixture/${name}`, sf]]);
};

test(
  'requests: every request start is a declared site',
  () => {
    const { p, tree, g } = theWorld();
    const found = walkStarts(p, g, tree, SITE_MEMBERS);
    const problems = [
      ...found.problems,
      ...checkRows(found.starts, REQUEST_SITES, tree),
      ...unlistedPorts(p, tree),
      ...checkFlows(p, g, tree),
      ...svelteSources().flatMap(([file, source]) => checkComponent(file, source, g.requestNames)),
    ];
    expect(problems).toEqual([]);
    // Non-vacuous: the walk read every file on disk it should, found its starts, and the guards resolved.
    const onDisk = ts.sys
      .readDirectory(SRC, ['.ts'])
      .map((f) => slash(f).slice(SRC.length + 1))
      .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.d.ts') && !f.startsWith('api/generated/') && !f.startsWith('story-gen/'))
      .sort();
    expect([...tree.keys()].sort()).toEqual(onDisk);
    expect(found.starts.length).toBeGreaterThan(50);
    expect(g.ports.size).toBeGreaterThan(20);
    expect([...new Set(g.scene.values())].sort()).toEqual(SCENE_LOADS.names.map((n) => `${SCENE_LOADS.type}.${n}`).sort());
  },
  WALK_TIMEOUT_MS,
);

/** The fixture's flows, by function: the line it must report, or null for none. */
const FLOW_CASES: Readonly<Record<string, string | null>> = {
  retyped: 're-typed Endpoints.getPuzzle',
  picked: null,
  frozen: null,
  intoConstraint: 're-typed YieldsHost.apply',
  intoParameter: null,
  intoUnknown: 'widened YieldsHost.apply',
  intoObject: 'widened YieldsHost.apply',
  intoEmpty: 'widened YieldsHost.apply',
};

test(
  'requests: a Pick of a port resolves to the port\'s member',
  () => {
    const w = theWorld();
    const { p, g } = w;
    const files = fixture(w, 'resolve.ts');
    // The walk's own resolver over the fixture: the starts it finds, and what each property reference resolves to.
    const starts = walkStarts(p, g, files, SITE_MEMBERS)
      .starts.map((s) => `${s.fn} ${s.member}`)
      .sort();
    const resolved: string[] = [];
    for (const sf of files.values()) {
      each(sf, (n) => {
        if (ts.isPropertyAccessExpression(n) && !isTypePosition(n)) {
          const sym = referencedProperty(p, n);
          const guard = firstIn(declsOf(sym), g.guarded) ?? '-';
          const transport = isTransport(p, g, p.checker.getTypeAtLocation(n)) ? ' transport' : '';
          resolved.push(`${fnOf(n).fn} ${n.getText()} ${guard}${transport}`);
        }
      });
    }
    const flows = checkFlows(p, g, files);
    const flowsOf = (fn: string, line: string | null): string[] => {
      const at = ` requests-fixture/resolve.ts ${fn}`;
      const lines = flows.filter((l) => l.endsWith(at)).map((l) => l.slice(0, -at.length));
      // A widening names every guarded member the value carries; the case pins the batch member's line among them.
      return line?.startsWith('widened ') === true && lines.includes(line) && lines.every((l) => l.startsWith('widened ')) ? [line] : lines.sort();
    };
    expect({ starts, resolved: resolved.sort(), flows: Object.fromEntries(Object.entries(FLOW_CASES).map(([fn, line]) => [fn, flowsOf(fn, line)])) }).toEqual({
      starts: ['viaAlias FetchAsset', 'viaHttpPick Http.fetchAsset', 'viaPick Endpoints.getPuzzle', 'viaPort Endpoints.getPuzzle'],
      resolved: [
        'frozen Object.freeze -',
        'viaHostPick h.apply YieldsHost.apply',
        'viaHttpPick http.fetchAsset Http.fetchAsset transport',
        'viaPick api.getPuzzle Endpoints.getPuzzle',
        'viaPort api.getPuzzle Endpoints.getPuzzle',
      ],
      flows: Object.fromEntries(Object.entries(FLOW_CASES).map(([fn, line]) => [fn, line === null ? [] : [line]])),
    });
  },
  WALK_TIMEOUT_MS,
);

test(
  'requests: the host-wait walk\'s reach on the tree is the HOST_WAITS rows',
  () => {
    const w = theWorld();
    const { p, tree, g } = w;
    // The tree: the computed member set is the rows, by name (S1's scope itself is pinned, not only its rows).
    const found = hostWaits(p, hostRoot(p, tree, HOST_ROOT.file, HOST_ROOT.type), g.ports, inSrc);
    expect(checkHostWaits(found, HOST_WAITS)).toEqual([]);
    expect(found.members.length).toBe(HOST_WAITS.length);
    // A host with a new promise-returning member (a scene load wrapped in `game.ts`) is red until it has its row.
    const host = hostWaits(p, hostRoot(p, fixture(w, 'host.ts'), 'requests-fixture/host.ts', 'FixtureHost'), g.ports, inSrcOrFixture);
    expect(checkHostWaits(host, HOST_WAITS)).toEqual(['unlisted host wait FixtureHost.warm']);
  },
  WALK_TIMEOUT_MS,
);

/** The self-test's second site member: the fixture port's `touch` only inside `held(…, at: FixtureAt)`. */
const FIXTURE_SITE = {
  label: 'fixture',
  member: { file: 'requests-fixture/site.ts', type: 'FixturePort', name: 'touch' },
  site: { file: 'requests-fixture/site.ts', alias: 'FixtureAt' },
} as const satisfies SiteMember;

test(
  'requests: every site member stays in its site',
  () => {
    const w = theWorld();
    const { p, tree } = w;
    // The tree: every batch goes through `heldBy`'s `held`, once.
    expect(checkSiteMembers(p, tree, SITE_MEMBERS)).toEqual([]);
    // Every row is checked, not only the first: a second row whose member is referenced outside its site.
    const files = new Map([...tree, ...fixture(w, 'site.ts')]);
    expect(checkSiteMembers(p, files, [...SITE_MEMBERS, FIXTURE_SITE])).toEqual([
      'fixture outside held requests-fixture/site.ts held',
      'fixture outside held requests-fixture/site.ts elsewhere',
      'fixture site count 3',
    ]);
  },
  WALK_TIMEOUT_MS,
);
