// The story build's ink compiler (STAGING-DSL §11 `ink/compile`, `ink/todo`). The ONLY importer of `inkjs/full` in
// the repository: the client bundles the runtime alone. Every INCLUDE resolves against the chapter entry's directory
// (R4 §2.1, Inky semantics) through a handler that reads nothing but the in-memory story map, so the compiler never
// opens a file outside story/, whatever the source lint said. Compiler warnings are errors in this project.
import { Compiler as UntypedCompiler, CompilerOptions as UntypedCompilerOptions } from 'inkjs/full';
import type { Compiler as InkCompiler } from 'inkjs/compiler/Compiler';
import type { CompilerOptions as InkCompilerOptions } from 'inkjs/compiler/CompilerOptions';
import type { IFileHandler } from 'inkjs/compiler/IFileHandler';

import type { ChapterId } from '../../src/story/staging.ts';
import { LINT_CODES } from './lint.ts';
import type { Finding, LintCode, SourceChapter } from './lint.ts';

// inkjs/full's ink.d.mts re-exports through extensionless paths, which `module: nodenext` does not resolve, so its
// bindings arrive as `any`; the package's CJS typings of the same classes give them their real types.
const Compiler: typeof InkCompiler = UntypedCompiler;
const CompilerOptions: typeof InkCompilerOptions = UntypedCompilerOptions;

/** Story-relative posix key (e.g. 'ch1/main.ink') → the file's text with any BOM stripped, or null if absent. */
export type ReadInk = (key: string) => string | null;
/** One compiled chapter: the exact `ToJson()` text and the keys of the files it loaded, entry first. */
export type CompiledChapter = { chapter: ChapterId; json: string; files: readonly string[] };

/** The lint's rule (lint.ts `UNPLACEABLE_INCLUDE_RE`): a drive, a leading '/', or any '\' names no story file. */
const UNPLACEABLE_INCLUDE_RE = /^[A-Za-z]:|^\/|\\/;
/**
 * What the handler resolves a refused INCLUDE to. No story key can hold a NUL, so loading it always throws; inkjs
 * adds and removes the resolved name around each load, and a refused file loads as empty text, so one shared
 * marker can never meet itself in inkjs's recursive-INCLUDE check.
 */
const REFUSED = '\u0000refused';
/** `ERROR: '<file>' line <n>: <message>` (also `WARNING:` and `TODO:`), R4 §2.1. */
const DIAGNOSTIC_RE = /^[A-Z][A-Z ]*: '(.*?)' line (\d+): (.*)$/s;

function finding(code: LintCode, file: string, line: number, message: string): Finding {
  return { code, severity: LINT_CODES[code], file, line, message };
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * The story key an INCLUDE written in `entry`'s chapter names: a posix join on the entry's directory, normalized.
 * Null for a path that is not story-relative posix (a drive, a leading '/', any '\') or that climbs above story/.
 */
export function resolveInclude(entry: string, include: string): string | null {
  if (UNPLACEABLE_INCLUDE_RE.test(include)) {
    return null;
  }
  const out: string[] = [];
  for (const segment of `${dirname(entry)}/${include}`.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment !== '..') {
      out.push(segment);
    } else if (out.pop() === undefined) {
      return null;
    }
  }
  return out.length === 0 ? null : out.join('/');
}

/**
 * A compiler message as a finding. inkjs names the file by its parser's filename: the entry key for the root, the
 * raw INCLUDE string for an included file, mapped back through `keys`. Only the first line is kept: a failed load
 * appends the handler's own exception. A message that does not parse is kept verbatim on the entry, line 0.
 */
function diagnostic(code: LintCode, message: string, entry: string, keys: ReadonlyMap<string, string>): Finding {
  const m = DIAGNOSTIC_RE.exec(message);
  const file = m?.[1];
  const line = m?.[2];
  const text = m?.[3];
  const key = file === entry ? entry : file === undefined ? undefined : keys.get(file);
  if (key === undefined || line === undefined || text === undefined) {
    return finding(code, entry, 0, message);
  }
  return finding(code, key, Number(line), text.split('\n')[0] ?? text);
}

/**
 * Compiles one chapter from its entry. `compiled` is null iff the compiler reported an error or a warning, or
 * produced no JSON; every error and warning is an `ink/compile` finding, every author message (`TODO:`) `ink/todo`.
 */
export function compileChapter(ch: SourceChapter, read: ReadInk): { compiled: CompiledChapter | null; findings: Finding[] } {
  const source = read(ch.entry);
  if (source === null) {
    return { compiled: null, findings: [finding('ink/compile', ch.entry, 0, 'the entry file is missing')] };
  }
  const keys = new Map<string, string>();
  const files: string[] = [ch.entry];
  const handler: IFileHandler = {
    ResolveInkFilename: (filename: string, sourceFilename?: string | null): string => {
      // The root parser asks once, with no source, for the name it was given: the entry key itself.
      if (sourceFilename === undefined || sourceFilename === null) {
        return filename;
      }
      const key = resolveInclude(ch.entry, filename);
      if (key === null) {
        return REFUSED;
      }
      keys.set(filename, key);
      return key;
    },
    LoadInkFileContents: (filename: string): string => {
      const text = filename === REFUSED ? null : read(filename);
      if (text === null) {
        // inkjs reports the throw as `Failed to load: '<INCLUDE path>'`, an error, on the INCLUDE line.
        throw new Error(filename === REFUSED ? 'not a story-relative posix path inside story/' : 'no such file in story/');
      }
      if (!files.includes(filename)) {
        files.push(filename);
      }
      return text;
    },
  };
  const compiler = new Compiler(source, new CompilerOptions(ch.entry, [], false, null, handler));
  let json: string | null = null;
  try {
    const out = compiler.Compile().ToJson();
    json = typeof out === 'string' ? out : null;
  } catch {
    // "Compilation failed.": the reasons are in compiler.errors, reported below.
  }
  const findings: Finding[] = [
    ...compiler.errors.map((m) => diagnostic('ink/compile', m, ch.entry, keys)),
    ...compiler.warnings.map((m) => diagnostic('ink/compile', m, ch.entry, keys)),
    ...compiler.authorMessages.map((m) => diagnostic('ink/todo', m, ch.entry, keys)),
  ];
  if (json === null && !findings.some((f) => f.code === 'ink/compile')) {
    findings.push(finding('ink/compile', ch.entry, 0, 'the compiler produced no story'));
  }
  if (json === null || compiler.errors.length > 0 || compiler.warnings.length > 0) {
    return { compiled: null, findings };
  }
  return { compiled: { chapter: ch.id, json, files }, findings };
}
