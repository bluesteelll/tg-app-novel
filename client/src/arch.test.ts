// Architecture rules over the raw sources of src/ (and index.html). The lanes that add a rule (LW2, LP2) keep this
// file's contract: every rule has a red fixture, every exemption has an allow fixture, and detection is AST-based for
// TypeScript: a comment such as `// never 100vh` or a method named `confirm` must not trip a rule.
import ts from 'typescript';
import { expect, test } from 'vitest';

import indexHtml from '../index.html?raw';

const RULE_IDS = [
  'vh-unit',
  'window-open',
  'dialog',
  'html-sink',
  'service-worker',
  'cookie',
  'iframe',
  'history',
  'web-storage',
  'init-data-unsafe',
  'import-pixi',
  'import-inkjs',
  'import-ink-compiler',
  'import-gsap',
  'window-telegram',
  'audio-node',
  'ui-imports',
  'fetch-in-scene-audio',
  'authorization',
  'node-builtin',
  'texture-create',
  'import-outside-src',
  'pure-world',
] as const;

type RuleId = (typeof RULE_IDS)[number];
type Group = 'pattern' | 'boundary' | 'pure';
type Violation = { rule: RuleId; file: string; line: number; excerpt: string };
type Fixture = readonly [file: string, source: string];

/** "Forbidden anywhere in src/", "import boundaries" of the plan's module map, and the pure world layer (X4). */
const GROUP: Record<RuleId, Group> = {
  'vh-unit': 'pattern',
  'window-open': 'pattern',
  dialog: 'pattern',
  'html-sink': 'pattern',
  'service-worker': 'pattern',
  cookie: 'pattern',
  iframe: 'pattern',
  history: 'pattern',
  'web-storage': 'pattern',
  'init-data-unsafe': 'pattern',
  'import-pixi': 'boundary',
  'import-inkjs': 'boundary',
  'import-ink-compiler': 'boundary',
  'import-gsap': 'boundary',
  'window-telegram': 'boundary',
  'audio-node': 'boundary',
  'ui-imports': 'boundary',
  'fetch-in-scene-audio': 'boundary',
  authorization: 'boundary',
  'node-builtin': 'boundary',
  'texture-create': 'boundary',
  'import-outside-src': 'boundary',
  'pure-world': 'pure',
};

/** Paths are relative to src/; index.html sits one level up. */
const INDEX_HTML = '../index.html';

// ---------------------------------------------------------------------------------------------------------------
// Engine

const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);
const DIALOGS = new Set(['alert', 'confirm', 'prompt']);
const HTML_SINK_PROPS = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML']);
const HISTORY_NAV = new Set(['pushState', 'replaceState', 'back', 'forward', 'go']);
const WEB_STORAGE = new Set(['localStorage', 'sessionStorage']);
const ASSETS_LOADS = new Set(['load', 'loadBundle', 'backgroundLoad', 'backgroundLoadBundle']);
const PIXI_TEXTURE_NAMES = new Set(['Texture', 'Sprite', 'Assets']);
const AUTHORIZATION = /^authorization$/i;
const VH_LENGTH = /(?<![\w-])\d*\.?\d+[dsl]?vh\b/g;
// `${h}vh` in a template, `{h}vh` in Svelte markup: the number is an expression, the unit is still vh.
const VH_AFTER_TEMPLATE_SPAN = /^[dsl]?vh\b/;
const VH_AFTER_MUSTACHE = /\}\s*[dsl]?vh\b/g;

// PUZZLES-PLAN X3/X4: the world layer the runtime and the story tool share. The build proves the rules the player
// runs only while these modules read nothing but their arguments: no DOM, network, storage, Svelte, clock or
// randomness. Their value imports stay inside the layer and its pure dependencies, so purity is transitive.
const PURE_WORLD_FILES = [
  'world/types.ts',
  'world/decode.ts',
  'puzzles/rules/index.ts',
  'puzzles/rules/code.ts',
  'puzzles/rules/order.ts',
  'explore/state.ts',
  'explore/reduce.ts',
  'explore/project.ts',
  'explore/reconcile.ts',
] as const;
const PURE_WORLD_DEPS = new Set(['story/staging.ts', 'story/catalog.ts', 'story/tags.ts']);
const PURE_WORLD_GLOBALS = new Set([
  'document',
  'window',
  'globalThis',
  'self',
  'navigator',
  'location',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'performance',
  'crypto',
  'Date',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'requestAnimationFrame',
]);

function isPureWorld(file: string): boolean {
  return (
    file.startsWith('world/') ||
    file.startsWith('puzzles/rules/') ||
    (PURE_WORLD_FILES as readonly string[]).includes(file) ||
    PURE_WORLD_DEPS.has(file)
  );
}

/** Where a rule applies; everything outside is the rule's exemption. */
function applies(rule: RuleId, file: string): boolean {
  switch (rule) {
    case 'web-storage':
      return !file.startsWith('telegram/dev/');
    case 'import-pixi':
      return !file.startsWith('scene/');
    case 'import-inkjs':
      return file !== 'story/runner.ts';
    case 'import-gsap':
      return file !== 'scene/executor.ts';
    case 'window-telegram':
      return file !== 'telegram/webapp.ts' && !file.startsWith('telegram/dev/');
    case 'audio-node':
      return !file.startsWith('audio/');
    case 'ui-imports':
      return file.startsWith('ui/');
    case 'fetch-in-scene-audio':
      return file.startsWith('scene/') || file.startsWith('audio/');
    case 'authorization':
      return !file.startsWith('api/');
    case 'texture-create':
      return file !== 'scene/loader.ts' && file !== 'scene/registry.ts';
    case 'pure-world':
      return isPureWorld(file);
    default:
      return true;
  }
}

/** Text-level rules for markup (Svelte markup, index.html); comments are already blanked. */
const MARKUP_RULES: ReadonlyArray<readonly [RuleId, RegExp]> = [
  ['vh-unit', VH_LENGTH],
  ['vh-unit', VH_AFTER_MUSTACHE],
  ['window-open', /\b(?:window|globalThis|self)\s*\.\s*open\b/g],
  ['dialog', /(?<![\w$.])(?:alert|confirm|prompt)\s*\(/g],
  ['html-sink', /\{@html\b/g],
  ['html-sink', /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/g],
  ['html-sink', /\bdocument\s*\.\s*write(?:ln)?\b/g],
  ['service-worker', /\bserviceWorker\b/g],
  ['cookie', /\bdocument\s*\.\s*cookie\b/g],
  ['iframe', /<iframe\b/gi],
  ['history', /\bhistory\s*\.\s*(?:pushState|replaceState|back|forward|go)\b/g],
  ['web-storage', /\b(?:localStorage|sessionStorage)\b/g],
  ['init-data-unsafe', /\binitDataUnsafe\b/g],
  // Case-sensitive: index.html legitimately loads https://telegram.org/js/telegram-web-app.js.
  ['window-telegram', /\bTelegram\b/g],
  ['audio-node', /<audio\b/gi],
  ['audio-node', /\b(?:webkit)?AudioContext\b/g],
  ['audio-node', /\bnew\s+Audio\s*\(/g],
  ['fetch-in-scene-audio', /(?<![\w$.])fetch\s*\(/g],
  ['fetch-in-scene-audio', /\b(?:window|globalThis|self)\s*\.\s*fetch\b/g],
  ['fetch-in-scene-audio', /\bXMLHttpRequest\b/g],
  ['authorization', /\bAuthorization\b/g],
  ['texture-create', /\b(?:Texture|Sprite)\s*\.\s*from\b/g],
  ['texture-create', /\bnew\s+Texture\b/g],
  ['texture-create', /\bAssets\s*\.\s*(?:load|loadBundle|backgroundLoad|backgroundLoadBundle)\b/g],
  ['texture-create', /\bcreateImageBitmap\b/g],
];

function violations(files: Readonly<Record<string, string>>): Violation[] {
  const out: Violation[] = [];
  for (const [file, text] of Object.entries(files)) {
    if (file.endsWith('.ts')) {
      scanScript(file, text, out);
    } else if (file.endsWith('.svelte') || file.endsWith('.html')) {
      const parts = splitDocument(text);
      scanScript(file, parts.script, out);
      scanText(file, parts.markup, MARKUP_RULES, out);
      scanText(file, parts.style, [['vh-unit', VH_LENGTH]], out);
    }
  }
  return out;
}

/** Keeps offsets and line numbers: every character except a newline becomes a space. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * Splits a .svelte / .html document into three same-length views: script bodies (parsed as TypeScript), markup
 * (tags and text, HTML comments blanked) and style bodies (CSS comments blanked).
 */
function splitDocument(text: string): { script: string; markup: string; style: string } {
  const clean = text.replace(/<!--[\s\S]*?-->/g, blank);
  const block = /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi;
  let script = '';
  let markup = '';
  let style = '';
  let last = 0;
  for (const m of clean.matchAll(block)) {
    const [whole, open = '', tag = '', body = '', close = ''] = m;
    const before = clean.slice(last, m.index);
    const isScript = tag.toLowerCase() === 'script';
    script += blank(before + open) + (isScript ? body : blank(body)) + blank(close);
    style += blank(before + open) + (isScript ? blank(body) : body) + blank(close);
    markup += before + open + blank(body) + close;
    last = m.index + whole.length;
  }
  const rest = clean.slice(last);
  return {
    script: script + blank(rest),
    markup: markup + rest,
    style: (style + blank(rest)).replace(/\/\*[\s\S]*?\*\//g, blank),
  };
}

function lineAt(text: string, index: number): { line: number; excerpt: string } {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  const line = text.slice(0, index).split('\n').length;
  return { line, excerpt: text.slice(start, end === -1 ? undefined : end).trim().slice(0, 100) };
}

function scanText(
  file: string,
  text: string,
  rules: ReadonlyArray<readonly [RuleId, RegExp]>,
  out: Violation[],
): void {
  for (const [rule, re] of rules) {
    if (!applies(rule, file)) {
      continue;
    }
    for (const m of text.matchAll(re)) {
      out.push({ rule, file, ...lineAt(text, m.index) });
    }
  }
}

type Ctx = {
  file: string;
  sf: ts.SourceFile;
  out: Violation[];
  /** Local name -> Pixi export name, for `import { Texture as T } from 'pixi.js'`. */
  pixiAliases: Map<string, string>;
};

function report(ctx: Ctx, rule: RuleId, node: ts.Node, inScope = applies(rule, ctx.file)): void {
  if (!inScope) {
    return;
  }
  const { line } = ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf));
  const excerpt = node.getText(ctx.sf).replace(/\s+/g, ' ').slice(0, 100);
  ctx.out.push({ rule, file: ctx.file, line: line + 1, excerpt });
}

function scanScript(file: string, text: string, out: Violation[]): void {
  if (text.trim() === '') {
    return;
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ctx: Ctx = { file, sf, out, pixiAliases: collectPixiAliases(sf) };
  const visit = (node: ts.Node): void => {
    checkNode(ctx, node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function isPixiSpecifier(spec: string): boolean {
  return spec === 'pixi.js' || spec.startsWith('pixi.js/') || spec.startsWith('@pixi/');
}

function collectPixiAliases(sf: ts.SourceFile): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) {
      continue;
    }
    const bindings = stmt.importClause?.namedBindings;
    if (!isPixiSpecifier(stmt.moduleSpecifier.text) || bindings === undefined || !ts.isNamedImports(bindings)) {
      continue;
    }
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text;
      if (PIXI_TEXTURE_NAMES.has(imported)) {
        aliases.set(el.name.text, imported);
      }
    }
  }
  return aliases;
}

function isGlobalObject(e: ts.Expression): boolean {
  return ts.isIdentifier(e) && GLOBAL_OBJECTS.has(e.text);
}

/** `x.name` or `x['name']`. */
function member(node: ts.Node): { obj: ts.Expression; name: string } | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return { obj: node.expression, name: node.name.text };
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return { obj: node.expression, name: node.argumentExpression.text };
  }
  return undefined;
}

/** `name` itself, or `window.name` / `globalThis.name` / `self.name`. */
function isGlobal(e: ts.Expression, name: string): boolean {
  if (ts.isIdentifier(e)) {
    return e.text === name;
  }
  const m = member(e);
  return m !== undefined && m.name === name && isGlobalObject(m.obj);
}

/** The last name of `a.b.C`, with Pixi import aliases resolved. */
function rightName(ctx: Ctx, e: ts.Expression): string | undefined {
  if (ts.isIdentifier(e)) {
    return ctx.pixiAliases.get(e.text) ?? e.text;
  }
  if (ts.isPropertyAccessExpression(e)) {
    return e.name.text;
  }
  return undefined;
}

function isPropertyName(node: ts.Identifier): boolean {
  const p = node.parent;
  return (
    ((ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertyAccessExpression(p)) &&
      p.name === node) ||
    ts.isShorthandPropertyAssignment(p)
  );
}

function checkNode(ctx: Ctx, node: ts.Node): void {
  if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    checkLiteral(ctx, node, node.text);
  }
  if (ts.isIdentifier(node)) {
    checkIdentifier(ctx, node);
  }
  const m = member(node);
  if (m !== undefined) {
    checkMember(ctx, node, m.obj, m.name);
  }
  if (ts.isCallExpression(node)) {
    checkCall(ctx, node);
  }
  if (ts.isNewExpression(node)) {
    const name = rightName(ctx, node.expression);
    if (name !== undefined && (name.endsWith('AudioContext') || name === 'Audio')) {
      report(ctx, 'audio-node', node);
    }
    if (name === 'Texture') {
      report(ctx, 'texture-create', node);
    }
  }
  checkImport(ctx, node);
  if (importOrigins(node).some((o) => reachesOutsideSrc(ctx.file, o))) {
    report(ctx, 'import-outside-src', node);
  }
}

function checkLiteral(ctx: Ctx, node: ts.Node, text: string): void {
  if (text.match(VH_LENGTH) !== null) {
    report(ctx, 'vh-unit', node);
  }
  if ((ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && VH_AFTER_TEMPLATE_SPAN.test(text)) {
    report(ctx, 'vh-unit', node);
  }
  if (/<iframe\b/i.test(text)) {
    report(ctx, 'iframe', node);
  }
  if (text === 'serviceWorker') {
    report(ctx, 'service-worker', node);
  }
  if (text === 'initDataUnsafe') {
    report(ctx, 'init-data-unsafe', node);
  }
  if (AUTHORIZATION.test(text)) {
    report(ctx, 'authorization', node);
  }
}

function checkIdentifier(ctx: Ctx, node: ts.Identifier): void {
  const text = node.text;
  if (text === 'serviceWorker') {
    report(ctx, 'service-worker', node);
  }
  if (WEB_STORAGE.has(text)) {
    report(ctx, 'web-storage', node);
  }
  if (HTML_SINK_PROPS.has(text)) {
    report(ctx, 'html-sink', node);
  }
  if (text === 'Telegram') {
    report(ctx, 'window-telegram', node);
  }
  if (text === 'XMLHttpRequest') {
    report(ctx, 'fetch-in-scene-audio', node);
  }
  if (text === 'initDataUnsafe') {
    // The facade declares the field so it can be typed and ignored; nothing may read it.
    const declaration =
      ctx.file === 'telegram/webapp.ts' && ts.isPropertySignature(node.parent) && node.parent.name === node;
    if (!declaration) {
      report(ctx, 'init-data-unsafe', node);
    }
  }
  if (AUTHORIZATION.test(text) && isPropertyName(node)) {
    report(ctx, 'authorization', node);
  }
  if (PURE_WORLD_GLOBALS.has(text) && !isMemberName(node)) {
    report(ctx, 'pure-world', node);
  }
}

/** A name that is a member, not a reference: `o.document`, `{ document: 1 }`, a method or a qualified type name. */
function isMemberName(node: ts.Identifier): boolean {
  const p = node.parent;
  const named =
    ts.isPropertyAccessExpression(p) ||
    ts.isPropertyAssignment(p) ||
    ts.isPropertySignature(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isMethodSignature(p) ||
    ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p);
  // A shorthand `{ document }` reads the global, so here it is a reference (unlike isPropertyName).
  return (named && p.name === node) || (ts.isQualifiedName(p) && p.right === node) || (ts.isBindingElement(p) && p.propertyName === node);
}

function checkMember(ctx: Ctx, node: ts.Node, obj: ts.Expression, name: string): void {
  if (name === 'open' && isGlobalObject(obj)) {
    report(ctx, 'window-open', node);
  }
  if (DIALOGS.has(name) && isGlobalObject(obj)) {
    report(ctx, 'dialog', node);
  }
  if ((name === 'write' || name === 'writeln') && isGlobal(obj, 'document')) {
    report(ctx, 'html-sink', node);
  }
  if (name === 'cookie' && isGlobal(obj, 'document')) {
    report(ctx, 'cookie', node);
  }
  if (HISTORY_NAV.has(name) && isGlobal(obj, 'history')) {
    report(ctx, 'history', node);
  }
  if (name.endsWith('AudioContext') && isGlobalObject(obj)) {
    report(ctx, 'audio-node', node);
  }
  if (name === 'fetch' && isGlobalObject(obj)) {
    report(ctx, 'fetch-in-scene-audio', node);
  }
  if (name === 'createImageBitmap' && isGlobalObject(obj)) {
    report(ctx, 'texture-create', node);
  }
  if (name === 'random' && ts.isIdentifier(obj) && obj.text === 'Math') {
    report(ctx, 'pure-world', node);
  }
  const owner = rightName(ctx, obj);
  if ((name === 'from' && (owner === 'Texture' || owner === 'Sprite')) || (ASSETS_LOADS.has(name) && owner === 'Assets')) {
    report(ctx, 'texture-create', node);
  }
  if (ts.isElementAccessExpression(node)) {
    // Property-access forms are caught as identifiers; element access hides the name in a string.
    if (HTML_SINK_PROPS.has(name)) {
      report(ctx, 'html-sink', node);
    }
    if (WEB_STORAGE.has(name)) {
      report(ctx, 'web-storage', node);
    }
    if (name === 'Telegram') {
      report(ctx, 'window-telegram', node);
    }
  }
}

function checkCall(ctx: Ctx, node: ts.CallExpression): void {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    if (DIALOGS.has(callee.text)) {
      report(ctx, 'dialog', node);
    }
    if (callee.text === 'fetch') {
      report(ctx, 'fetch-in-scene-audio', node);
    }
    if (callee.text === 'createImageBitmap') {
      report(ctx, 'texture-create', node);
    }
  }
  const m = member(callee);
  const arg = node.arguments[0];
  if (m !== undefined && m.name === 'createElement' && arg !== undefined && ts.isStringLiteralLike(arg)) {
    const tag = arg.text.toLowerCase();
    if (tag === 'iframe') {
      report(ctx, 'iframe', node);
    }
    if (tag === 'audio') {
      report(ctx, 'audio-node', node);
    }
  }
}

/** Every module specifier: static import, export-from, dynamic import(), and `import('x').T` type queries. */
function moduleReference(node: ts.Node): { spec: string; typeOnly: boolean } | undefined {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    // `import { type X }` keeps the declaration (verbatimModuleSyntax): only `import type` is type-only.
    const typeOnly = node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    return { spec: node.moduleSpecifier.text, typeOnly };
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
    return { spec: node.moduleSpecifier.text, typeOnly: node.isTypeOnly };
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const arg = node.arguments[0];
    return arg !== undefined && ts.isStringLiteralLike(arg) ? { spec: arg.text, typeOnly: false } : undefined;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
    return { spec: node.argument.literal.text, typeOnly: true };
  }
  return undefined;
}

function checkImport(ctx: Ctx, node: ts.Node): void {
  const ref = moduleReference(node);
  if (ref === undefined) {
    return;
  }
  const { spec, typeOnly } = ref;
  if (spec.startsWith('node:')) {
    report(ctx, 'node-builtin', node);
  }
  if (spec === 'svelte-pixi' || spec.startsWith('svelte-pixi/')) {
    report(ctx, 'import-pixi', node, true); // forbidden everywhere, scene/ included
  }
  if (isPixiSpecifier(spec)) {
    report(ctx, 'import-pixi', node);
  }
  if (/^inkjs\/(?:full|compiler)(?:\/|$)/.test(spec)) {
    report(ctx, 'import-ink-compiler', node, true); // the runner included
  } else if (spec === 'inkjs' || spec.startsWith('inkjs/')) {
    report(ctx, 'import-inkjs', node);
  }
  if (spec === 'gsap' || spec.startsWith('gsap/') || spec.startsWith('@gsap/')) {
    report(ctx, 'import-gsap', node);
  }
  if (!typeOnly && (spec.startsWith('.') || spec.startsWith('/'))) {
    const target = new URL(spec, `file:///src/${ctx.file}`).pathname;
    if (/^\/src\/(?:story|scene|audio)\//.test(target)) {
      report(ctx, 'ui-imports', node);
    }
  }
  if (spec === 'svelte' || spec.startsWith('svelte/') || /\.svelte(?:\.ts)?$/.test(spec)) {
    report(ctx, 'pure-world', node); // type-only too: the pure layer knows no component or store
  } else if (!typeOnly && !isPureWorldTarget(ctx.file, spec)) {
    report(ctx, 'pure-world', node);
  }
}

/** A relative or /src/ import that resolves into the pure world layer or its pure dependencies; never a package. */
function isPureWorldTarget(file: string, spec: string): boolean {
  if (!spec.startsWith('.') && !spec.startsWith('/')) {
    return false;
  }
  const target = new URL(spec, `file:///src/${file}`).pathname;
  return target.startsWith('/src/') && isPureWorld(target.slice('/src/'.length));
}

// ---------------------------------------------------------------------------------------------------------------
// import-outside-src (STORIES-PLAN ST1; PROTOTYPE-PLAN LS1 commit 5): every file a non-test src/ module can pull into
// the bundle stays under src/, so story/stories.json, server/content/ or any other repo file never enters it by a
// relative path. Each reference is read for the files Vite 8.3.5 can load from it, or refused when no static reading
// can bound them. Type-only imports and `import('x').T` are erased; bare package specifiers resolve into node_modules.

/** One reference by what it can load: a path, a glob (with `import.meta.glob`'s `base`), or nothing provable. */
type Origin = { form: 'path'; spec: string } | { form: 'glob'; pattern: string; base: string | null } | { form: 'opaque' };

/** `import.meta.<name>`. */
function isImportMeta(e: ts.Expression, name: string): boolean {
  return (
    ts.isPropertyAccessExpression(e) &&
    ts.isMetaProperty(e.expression) &&
    e.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    e.name.text === name
  );
}

function isPlus(e: ts.Expression): e is ts.BinaryExpression {
  return ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken;
}

/**
 * The glob Vite derives from a dynamic argument (`vite:dynamic-import-vars` `templateLiteralToGlob` /
 * `expressionToGlob`; `vite:asset-import-meta-url` `buildGlobPattern`): string parts kept, every other part `*`.
 */
function expressionGlob(e: ts.Expression): string {
  if (ts.isStringLiteralLike(e)) {
    return e.text;
  }
  if (ts.isTemplateExpression(e)) {
    return e.head.text + e.templateSpans.map((span) => `*${span.literal.text}`).join('');
  }
  if (ts.isParenthesizedExpression(e)) {
    return expressionGlob(e.expression);
  }
  return isPlus(e) ? expressionGlob(e.left) + expressionGlob(e.right) : '*';
}

/** A dynamic `import()` argument: a literal is a path; a template or a `+` join is a glob; anything else is opaque. */
function dynamicOrigin(arg: ts.Expression | undefined): Origin {
  if (arg !== undefined && ts.isStringLiteralLike(arg)) {
    return { form: 'path', spec: arg.text };
  }
  if (arg !== undefined && (ts.isTemplateExpression(arg) || isPlus(arg))) {
    return { form: 'glob', pattern: expressionGlob(arg), base: null };
  }
  return { form: 'opaque' };
}

/** The literal name of an object-literal member; null for a spread, a computed or a private name. */
function memberName(name: ts.PropertyName | undefined): string | null {
  return name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : null;
}

/**
 * `import.meta.glob(p, o)`: each pattern of `p` (a string or an array of strings) with `o.base`; a `!` pattern only
 * excludes. Opaque when a pattern is not a literal, or the options are not an object literal of literally named
 * members with a string `base`.
 */
function globOrigins(call: ts.CallExpression): Origin[] {
  const [patterns, options] = call.arguments;
  let base: string | null = null;
  if (options !== undefined) {
    if (!ts.isObjectLiteralExpression(options) || options.properties.some((p) => memberName(p.name) === null)) {
      return [{ form: 'opaque' }];
    }
    const prop = options.properties.find((p) => memberName(p.name) === 'base');
    if (prop !== undefined) {
      if (!ts.isPropertyAssignment(prop) || !ts.isStringLiteralLike(prop.initializer)) {
        return [{ form: 'opaque' }];
      }
      base = prop.initializer.text;
    }
  }
  const list = patterns === undefined ? [] : ts.isArrayLiteralExpression(patterns) ? [...patterns.elements] : [patterns];
  const texts = list.flatMap((e) => (ts.isStringLiteralLike(e) ? [e.text] : []));
  if (list.length === 0 || texts.length !== list.length) {
    return [{ form: 'opaque' }];
  }
  return texts.filter((t) => !t.startsWith('!')).map((pattern) => ({ form: 'glob', pattern, base }));
}

/**
 * What a node can make Vite load: a static import (not `import type`), an export-from (not `export type`), a dynamic
 * `import()`, `import.meta.glob`, or `new URL(…, import.meta.url)`; nothing for any other node.
 */
function importOrigins(node: ts.Node): readonly Origin[] {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    const typeOnly = node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    return typeOnly ? [] : [{ form: 'path', spec: node.moduleSpecifier.text }];
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.isTypeOnly ? [] : [{ form: 'path', spec: node.moduleSpecifier.text }];
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return [dynamicOrigin(node.arguments[0])];
  }
  if (ts.isCallExpression(node) && isImportMeta(node.expression, 'glob')) {
    return globOrigins(node);
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
    const [spec, base] = node.arguments ?? [];
    if (base === undefined || !isImportMeta(base, 'url')) {
      return []; // a URL against another base is no asset reference
    }
    if (spec !== undefined && ts.isStringLiteralLike(spec)) {
      return [{ form: 'path', spec: spec.text }];
    }
    if (spec !== undefined && ts.isTemplateExpression(spec)) {
      return [{ form: 'glob', pattern: expressionGlob(spec), base: null }];
    }
    return [{ form: 'opaque' }];
  }
  return [];
}

/** Under /src/ once resolved against `from` (a file: URL), as `ui-imports` resolves a specifier. */
function underSrc(spec: string, from: string): boolean {
  return new URL(spec, from).pathname.startsWith('/src/');
}

/**
 * Whether an origin can load a file outside src/. A path resolves from the importer (a `#` head is a package import
 * map, refused); a bare specifier is a package. A glob resolves as Vite's `toAbsoluteGlob`: `/` from the project
 * root, `./` or `../` from `base` (a `/` base from the root, a relative one from the importer) or the importer. Its
 * static directory (the head before the first `*`, `?`, `[` or `{`, up to its last `/`) must lie under src/, and no
 * `..` may follow the first wildcard; any other head is refused. An opaque reference is refused.
 */
function reachesOutsideSrc(file: string, o: Origin): boolean {
  const from = `file:///src/${file}`;
  switch (o.form) {
    case 'opaque':
      return true;
    case 'path':
      if (o.spec.startsWith('#')) {
        return true;
      }
      return (o.spec.startsWith('.') || o.spec.startsWith('/')) && !underSrc(o.spec, from);
    case 'glob': {
      const wild = o.pattern.search(/[*?[{]/);
      const head = wild < 0 ? o.pattern : o.pattern.slice(0, wild);
      const dir = head.slice(0, head.lastIndexOf('/') + 1);
      if (o.pattern.slice(dir.length).split('/').includes('..')) {
        return true;
      }
      if (dir.startsWith('/')) {
        return !underSrc(dir, 'file:///');
      }
      if (!dir.startsWith('./') && !dir.startsWith('../')) {
        return true; // empty, `**`, `#` or a bare name: Vite hands it to resolveId
      }
      if (o.base === null) {
        return !underSrc(dir, from);
      }
      const base = o.base.endsWith('/') ? o.base : `${o.base}/`;
      return !underSrc(dir, new URL(base, base.startsWith('/') ? 'file:///' : from).href);
    }
    default: {
      const unhandled: never = o;
      throw new Error(`invariant: unhandled origin ${String(unhandled)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The real tree

function loadSources(): Record<string, string> {
  // `?raw` returns the file text before any plugin transform (vite-plugin-svelte skips plain `?raw` requests).
  const raw = import.meta.glob<string>(['./**/*.ts', './**/*.svelte', '!./**/*.test.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(raw)) {
    out[key.replace(/^\.\//, '')] = text;
  }
  return out;
}

const SOURCES = loadSources();
const TREE: Record<string, string> = { ...SOURCES, [INDEX_HTML]: indexHtml };

test('arch: scans raw sources', () => {
  const keys = Object.keys(SOURCES);
  expect(keys).toContain('main.ts');
  expect(keys).toContain('ui/App.svelte');
  expect(keys.filter((key) => key.endsWith('.test.ts'))).toEqual([]);
  const app = SOURCES['ui/App.svelte'] ?? '';
  expect(app).toContain('<style');
  expect(app).not.toContain('svelte/internal');
  expect(indexHtml).toContain('telegram-web-app.js');
});

test('arch: forbidden patterns', () => {
  expect(violations(TREE).filter((v) => GROUP[v.rule] === 'pattern')).toEqual([]);
});

test('arch: import boundaries', () => {
  expect(violations(TREE).filter((v) => GROUP[v.rule] === 'boundary')).toEqual([]);
});

test('arch: pure world modules', () => {
  // Non-vacuous: the layer's files are scanned, so an empty or renamed tree cannot pass.
  const keys = Object.keys(SOURCES);
  for (const file of PURE_WORLD_FILES) {
    expect(keys, file).toContain(file);
  }
  expect(violations(TREE).filter((v) => GROUP[v.rule] === 'pure')).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// Red fixtures: every case must be flagged with its rule.

const RED: Record<RuleId, readonly Fixture[]> = {
  'vh-unit': [
    ['ui/A.svelte', '<div></div>\n<style>\n  div { height: 100vh; }\n</style>'],
    ['ui/B.svelte', '<div style="height: 50dvh"></div>'],
    ['ui/C.svelte', '<div style="height: {h}vh"></div>'],
    ['telegram/viewport.ts', "el.style.height = '100svh';"],
    ['telegram/viewport.ts', 'el.style.minHeight = `${n}lvh`;'],
    ['telegram/viewport.ts', 'const h = `calc(1.5vh + ${x}px)`;'],
    [INDEX_HTML, '<html><head><style>#app { height: 100vh; }</style></head></html>'],
  ],
  'window-open': [
    ['ui/x.ts', 'window.open(url);'],
    ['ui/x.ts', "globalThis.open(url, '_blank');"],
    ['ui/A.svelte', '<button onclick={() => window.open(url)}>x</button>'],
  ],
  dialog: [
    ['ui/x.ts', "alert('x');"],
    ['ui/x.ts', "const ok = confirm('sure');"],
    ['ui/x.ts', "const n = prompt('n');"],
    ['ui/x.ts', "window.alert('x');"],
    ['ui/x.ts', "self.confirm('x');"],
    ['ui/A.svelte', '<button onclick={() => alert(1)}>x</button>'],
  ],
  'html-sink': [
    ['ui/x.ts', 'el.innerHTML = s;'],
    ['ui/x.ts', 'el.outerHTML = s;'],
    ['ui/x.ts', "el.insertAdjacentHTML('beforeend', s);"],
    ['ui/x.ts', 'document.write(s);'],
    ['ui/x.ts', 'document.writeln(s);'],
    ['ui/x.ts', "el['innerHTML'] = s;"],
    ['ui/x.ts', 'Object.assign(el, { innerHTML: s });'],
    ['ui/A.svelte', '<p>{@html text}</p>'],
    ['ui/B.svelte', '<div contenteditable bind:innerHTML={s}></div>'],
  ],
  'service-worker': [
    ['app/boot.ts', "navigator.serviceWorker.register('/sw.js');"],
    ['app/boot.ts', "if ('serviceWorker' in navigator) { start(); }"],
    ['ui/A.svelte', '<p>{navigator.serviceWorker}</p>'],
  ],
  cookie: [
    ['api/session.ts', "document.cookie = 'a=b';"],
    ['api/session.ts', 'const c = window.document.cookie;'],
    ['api/session.ts', "const c = document['cookie'];"],
    ['ui/A.svelte', '<p>{document.cookie}</p>'],
  ],
  iframe: [
    ['ui/A.svelte', '<iframe src="https://example.org/"></iframe>'],
    ['ui/B.svelte', '<IFrame src="https://example.org/"></IFrame>'],
    ['ui/x.ts', "document.createElement('iframe');"],
    ['ui/x.ts', "const html = '<iframe src=x></iframe>';"],
    [INDEX_HTML, '<html><body><iframe src="x"></iframe></body></html>'],
  ],
  history: [
    ['ui/screens.ts', "history.pushState(null, '', '#x');"],
    ['ui/screens.ts', "history.replaceState(null, '');"],
    ['ui/screens.ts', 'window.history.back();'],
    ['ui/screens.ts', 'globalThis.history.forward();'],
    ['ui/screens.ts', 'history.go(-1);'],
    ['ui/A.svelte', '<button onclick={() => history.back()}>x</button>'],
  ],
  'web-storage': [
    ['saves/pending.ts', "localStorage.setItem('k', v);"],
    ['saves/pending.ts', "window.sessionStorage.getItem('k');"],
    ['saves/pending.ts', "const s = globalThis['localStorage'];"],
    ['telegram/webapp.ts', "localStorage.getItem('x');"],
    ['ui/A.svelte', "<p>{localStorage.getItem('k')}</p>"],
  ],
  'init-data-unsafe': [
    ['telegram/webapp.ts', 'const u = tg.initDataUnsafe.user;'],
    ['app/boot.ts', 'const u = webApp.initDataUnsafe;'],
    ['api/x.ts', "const key = 'initDataUnsafe';"],
    ['telegram/index.ts', 'interface X { initDataUnsafe: unknown }'],
    ['ui/A.svelte', '<p>{tg.initDataUnsafe}</p>'],
  ],
  'import-pixi': [
    ['app/game.ts', "import 'pixi.js/app';"],
    ['app/game.ts', "import { Application } from 'pixi.js';"],
    ['ui/x.ts', "import type { Texture } from 'pixi.js';"],
    ['story/x.ts', "export { Sprite } from 'pixi.js';"],
    ['app/engine.ts', "const pixi = import('pixi.js');"],
    ['ui/y.ts', "import { GlowFilter } from '@pixi/filter-glow';"],
    ['ui/z.ts', "let t: import('pixi.js').Texture;"],
    ['scene/controller.ts', "import { Stage } from 'svelte-pixi';"],
  ],
  'import-inkjs': [
    ['app/game.ts', "import { Story } from 'inkjs';"],
    ['story/tags.ts', "import type { Story } from 'inkjs';"],
    ['story/x.ts', "const ink = import('inkjs');"],
    ['ui/x.ts', "import { InkList } from 'inkjs/engine/InkList';"],
  ],
  'import-ink-compiler': [
    ['story/runner.ts', "import { Compiler } from 'inkjs/full';"],
    ['story/runner.ts', "import { Compiler } from 'inkjs/compiler/Compiler';"],
    ['app/game.ts', "const full = import('inkjs/full');"],
    ['story/x.ts', "import 'inkjs/compiler';"],
  ],
  'import-gsap': [
    ['scene/controller.ts', "import { gsap } from 'gsap';"],
    ['ui/x.ts', "import { Flip } from 'gsap/Flip';"],
    ['audio/bgm.ts', "const g = import('gsap');"],
  ],
  'window-telegram': [
    ['app/boot.ts', 'window.Telegram.WebApp.ready();'],
    ['ui/x.ts', "const tg = globalThis['Telegram'];"],
    ['telegram/index.ts', 'Telegram.WebApp.expand();'],
    ['ui/A.svelte', '<p>{window.Telegram.WebApp.version}</p>'],
  ],
  'audio-node': [
    ['scene/x.ts', 'const c = new AudioContext();'],
    ['scene/x.ts', 'const c = new window.webkitAudioContext();'],
    ['scene/x.ts', 'const c = new OfflineAudioContext(1, 1, 44100);'],
    ['scene/x.ts', "const a = new Audio('x.m4a');"],
    ['scene/x.ts', "const a = document.createElement('audio');"],
    ['scene/x.ts', 'const C = window.AudioContext;'],
    ['ui/A.svelte', '<audio src="x.m4a"></audio>'],
  ],
  'ui-imports': [
    ['ui/x.ts', "import { parseTags } from '../story/tags.ts';"],
    ['ui/x.ts', "import { type StagingCommand } from '../story/staging.ts';"],
    ['ui/x.ts', "const c = import('../scene/controller.ts');"],
    ['ui/A.svelte', "<script lang=\"ts\">\n  import { unlockAudio } from '../audio/unlock.ts';\n</script>\n<p></p>"],
    ['ui/sub/y.ts', "export { fit } from '../../scene/layout.ts';"],
    ['ui/z.ts', "export * from '../audio/manager.ts';"],
    ['ui/w.ts', "import '../story/runner.ts';"],
    ['ui/v.ts', "import { fit } from '/src/scene/layout.ts';"],
  ],
  'fetch-in-scene-audio': [
    ['scene/loader.ts', 'const r = fetch(url);'],
    ['audio/bgm.ts', 'const r = window.fetch(url);'],
    ['audio/bgm.ts', 'const r = globalThis.fetch(url);'],
    ['audio/sfx.ts', 'const r = self.fetch(url);'],
    ['audio/sfx.ts', 'const x = new XMLHttpRequest();'],
  ],
  authorization: [
    ['ui/x.ts', "const h = { Authorization: 'Bearer ' + t };"],
    ['story/chapters.ts', "headers.set('authorization', b);"],
    ['scene/loader.ts', 'const a = req.headers.Authorization;'],
    ['ui/A.svelte', '<p>{headers.Authorization}</p>'],
  ],
  'node-builtin': [
    ['app/boot.ts', "import { readFileSync } from 'node:fs';"],
    ['story/x.ts', "const p = import('node:path');"],
    ['ui/x.ts', "export { pathToFileURL } from 'node:url';"],
  ],
  'texture-create': [
    ['scene/executor.ts', 'const t = Texture.from(url);'],
    ['scene/executor.ts', 'const s = Sprite.from(blobUrl);'],
    ['scene/executor.ts', 'const t = new Texture({ source });'],
    ['scene/controller.ts', 'const t = await Assets.load(url);'],
    ['scene/controller.ts', "const b = await Assets.loadBundle('ch1');"],
    ['ui/x.ts', 'const b = await createImageBitmap(blob);'],
    ['ui/x.ts', 'const b = await window.createImageBitmap(blob);'],
    ['scene/preload.ts', "import { Texture as T } from 'pixi.js';\nconst t = T.from(u);"],
    ['scene/layout.ts', 'const t = PIXI.Texture.from(u);'],
  ],
  'import-outside-src': [
    // Each form with a literal argument.
    ['story/catalog.ts', "import stories from '../../../story/stories.json';"],
    ['app/content.ts', "const m = import('../../../server/content/chapters/ch2/meta.json');"],
    ['app/content.ts', "export { default } from '../../../server/content/chapters/ch2/meta.json';"],
    ['ui/A.svelte', "<script lang=\"ts\">\n  import s from '/story/stories.json?raw';\n</script>\n<p>{s}</p>"],
    ['app/content.ts', "const inks = import.meta.glob('../../../story/*/main.ink');"],
    ['app/content.ts', "const u = new URL('../../../server/content/stories.json', import.meta.url);"],
    // The forms only a glob reading, the `base` option or a refusal can judge.
    ['app/content.ts', 'const m = import(`../../../server/content/chapters/${id}/meta.json`);'],
    ['app/content.ts', 'const u = new URL(`../../../server/content/${f}.json`, import.meta.url);'],
    ['app/content.ts', "const g = import.meta.glob('./*.json', { base: '../../../server/content' });"],
    ['app/content.ts', "import s from '#content/stories.json';"],
    ['app/content.ts', 'const m = import(spec);'],
    ['app/content.ts', 'const m = import(`../story-gen/${x}/../../../server/a.json`);'],
  ],
  'pure-world': [
    ['explore/reduce.ts', 'document.title = s;'],
    ['world/decode.ts', 'const r = fetch(u);'],
    ['explore/state.ts', "localStorage.getItem('k');"],
    ['world/types.ts', 'const w = window.innerWidth;'],
    ['puzzles/rules/code.ts', "import { mount } from 'svelte';"],
    ['explore/project.ts', "import V from '../ui/View.svelte';"],
    ['explore/reconcile.ts', "import { tg } from '../telegram/webapp.ts';"],
    ['explore/reduce.ts', 'const r = Math.random();'],
    ['explore/reduce.ts', 'const t = Date.now();'],
    ['story/catalog.ts', 'const d = document;'],
    ['explore/reduce.ts', 'const o = { document };'],
    ['world/decode.ts', "import { z } from 'zod';"],
  ],
};

for (const rule of RULE_IDS) {
  test(`arch: ${rule} red on fixture`, () => {
    for (const [file, source] of RED[rule]) {
      const found = violations({ [file]: source }).map((v) => v.rule);
      expect(found, `${file}: ${source}`).toContain(rule);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Allow fixtures: legitimate code next to each exemption raises no violation at all.

const ALLOW: ReadonlyArray<readonly [RuleId, readonly Fixture[]]> = [
  [
    'vh-unit',
    [
      ['ui/Stage.svelte', '<!-- never 100vh -->\n<div></div>\n<style>\n  /* not 100vh */\n  div { height: var(--tg-viewport-stable-height); }\n</style>'],
      ['telegram/viewport.ts', '// never 100vh: the height comes from Telegram\nexport const height = 0;'],
    ],
  ],
  ['window-open', [['telegram/webapp.ts', 'tg.openLink(url);']]],
  [
    'dialog',
    [
      ['purchase/flow.ts', 'paywall.confirm();'],
      ['purchase/flow.ts', 'const dialog = { confirm() { return true; } };'],
    ],
  ],
  ['history', [['ui/screens.ts', 'screens.back();']]],
  ['web-storage', [['telegram/dev/mock-transport.ts', "const cloud = localStorage.getItem('__mock_cloud__');"]]],
  ['init-data-unsafe', [['telegram/webapp.ts', 'interface RawWebApp { initDataUnsafe: unknown }']]],
  ['import-pixi', [['scene/loader.ts', "import { Container } from 'pixi.js';"]]],
  ['import-inkjs', [['story/runner.ts', "import { Story } from 'inkjs';"]]],
  ['import-gsap', [['scene/executor.ts', "import { gsap } from 'gsap';"]]],
  [
    'window-telegram',
    [
      ['telegram/webapp.ts', 'const webApp = window.Telegram.WebApp;'],
      ['telegram/dev/x.ts', 'window.Telegram.WebView.receiveEvent(type, data);'],
    ],
  ],
  ['audio-node', [['audio/unlock.ts', 'const ctx = new AudioContext();']]],
  [
    'ui-imports',
    [
      ['ui/x.ts', "import type { StagingSnapshot } from '../story/staging.ts';"],
      ['ui/x.ts', "import { t } from '../i18n/index.ts';"],
    ],
  ],
  [
    'fetch-in-scene-audio',
    [
      ['scene/loader.ts', 'const blob = await fetchAsset(ref);'],
      ['api/http.ts', 'const r = await fetch(url);'],
    ],
  ],
  ['authorization', [['api/http.ts', "const h = { Authorization: 'Bearer ' + token };"]]],
  [
    'texture-create',
    [
      ['scene/executor.ts', "import { Sprite, Texture } from 'pixi.js';\nconst s = new Sprite(texture);\nconst w = Texture.WHITE;"],
      ['scene/loader.ts', "import { Texture } from 'pixi.js';\nconst b = await createImageBitmap(blob);\nconst t = Texture.from(b);"],
      ['scene/registry.ts', "import { Assets } from 'pixi.js';\nconst t = await Assets.load(url);"],
    ],
  ],
  [
    'import-outside-src',
    [
      // A value import of the public build output, from a module no other rule judges for it.
      ['app/boot.ts', "import catalog from '../story-gen/catalog.json';"],
      ['story/catalog.ts', "import type { StoryPlan } from '../../scripts/story/stories.ts';"],
      ['story/catalog.ts', "const free = import.meta.glob('../story-gen/free/*.story.json');"],
      ['story/catalog.ts', "const u = new URL('./x.ts', import.meta.url);"],
      ['story/catalog.ts', 'const m = import(`../story-gen/free/${id}.story.json`);'],
      ['story/catalog.ts', "const g = import.meta.glob('./*.json', { base: '../story-gen/free' });"],
    ],
  ],
  [
    'pure-world',
    [
      ['explore/controller.ts', 'document.title = s;'],
      ['explore/reduce.ts', "import { parseTags } from '../story/tags.ts';"],
      ['explore/reduce.ts', "import type { View } from '../ui/view.ts';"],
      ['world/decode.ts', 'const o = { document: 1 }; const d = w.docs;'],
      ['explore/reconcile.ts', "import { reduce } from './reduce.ts';\nconst n = s.date + o.random();"],
    ],
  ],
];

for (const [rule, fixtures] of ALLOW) {
  test(`arch: ${rule} allows fixtures`, () => {
    for (const [file, source] of fixtures) {
      expect(violations({ [file]: source }), `${file}: ${source}`).toEqual([]);
    }
  });
}
