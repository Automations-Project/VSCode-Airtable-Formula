/**
 * Pure script diagnostics -- no vscode imports.
 * SCRIPT-04 missing-await + SCRIPT-05 unknown-global.
 *
 * Security: all regex patterns are linear (no nested quantifiers).
 * T-03-01: character-class repetitions only per RESEARCH.md Pattern 4 and Pattern 5.
 */

import type { LsDiagnostic, LsRange } from '../../types.js';
import { LsSeverity } from '../../types.js';
import { SCRIPT_GLOBAL_NAMES } from './registry.js';

// ---------------------------------------------------------------------------
// Position helpers (verbatim from formula diagnostics.ts lines 24-38)
// ---------------------------------------------------------------------------

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') { line++; lastNewline = i; }
  }
  return { line, character: offset - lastNewline - 1 };
}

function makeRange(text: string, start: number, end: number): LsRange {
  return {
    start: offsetToPosition(text, start),
    end: offsetToPosition(text, end),
  };
}

// ---------------------------------------------------------------------------
// Exclusion ranges helper — single-pass tokenizer.
//
// Processes the file in one left-to-right pass so that comment delimiters
// consume any quote characters they contain before the string scanners can
// misinterpret them.  This prevents a lone apostrophe inside a // comment
// (e.g. "it's") from acting as an opening-quote that swallows the next real
// string's opening delimiter and leaves its content unprotected.
//
// Single-quoted and double-quoted strings are intentionally stopped at
// newlines: JavaScript strings can't span lines without a backslash
// continuation, so any apparent multi-line match would be a false parse.
// Template literals may span lines and are handled without a newline stop.
// ---------------------------------------------------------------------------

function getExclusionRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const len = text.length;
  let i = 0;

  while (i < len) {
    const ch = text[i];

    // Block comment  /* ... */
    if (ch === '/' && i + 1 < len && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const commentEnd = end !== -1 ? end + 2 : len;
      ranges.push({ start: i, end: commentEnd });
      i = commentEnd;
      continue;
    }

    // Single-line comment  // ...
    if (ch === '/' && i + 1 < len && text[i + 1] === '/') {
      let j = i + 2;
      while (j < len && text[j] !== '\n') j++;
      ranges.push({ start: i, end: j });
      i = j;
      continue;
    }

    // Template literal  ` ... ` (may span multiple lines)
    if (ch === '`') {
      let j = i + 1;
      while (j < len) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '`') { j++; break; }
        j++;
      }
      ranges.push({ start: i, end: j });
      i = j;
      continue;
    }

    // Double-quoted string  " ... "  (stops at newline — no multiline)
    if (ch === '"') {
      let j = i + 1;
      while (j < len) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        if (text[j] === '\n') break;
        j++;
      }
      ranges.push({ start: i, end: j });
      i = j;
      continue;
    }

    // Single-quoted string  ' ... '  (stops at newline — no multiline)
    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === "'") { j++; break; }
        if (text[j] === '\n') break;
        j++;
      }
      ranges.push({ start: i, end: j });
      i = j;
      continue;
    }

    i++;
  }

  return ranges;
}

function isInsideExclusionRange(
  position: number,
  ranges: Array<{ start: number; end: number }>
): boolean {
  return ranges.some(range => position >= range.start && position < range.end);
}

// ---------------------------------------------------------------------------
// JS built-in allowlist -- SCRIPT-05 must NOT flag these (D-05)
// ---------------------------------------------------------------------------

const KNOWN_SAFE = new Set<string>([
  // Airtable scripting globals
  ...SCRIPT_GLOBAL_NAMES,

  // Mandatory minimum (from REQUIREMENTS.md)
  'console', 'Math', 'JSON', 'Date', 'Promise', 'Array', 'Object', 'Error',
  'parseInt', 'parseFloat', 'setTimeout', 'clearTimeout',

  // Value properties
  'undefined', 'NaN', 'Infinity', 'globalThis',

  // Global functions
  'eval', 'isNaN', 'isFinite',
  'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',

  // Constructors and built-in objects
  'Function', 'Boolean', 'Symbol', 'Number', 'BigInt', 'String', 'RegExp',
  'Map', 'Set', 'WeakMap', 'WeakSet',
  'ArrayBuffer', 'DataView',
  'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array',
  'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
  'Reflect', 'Proxy',
  'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'EvalError', 'URIError', 'AggregateError',
  'WeakRef', 'FinalizationRegistry',

  // Runtime timing functions
  'setInterval', 'clearInterval', 'queueMicrotask',

  // Web APIs available in Airtable scripting environment
  'AbortController', 'AbortSignal',
  'URL', 'URLSearchParams',
  'TextEncoder', 'TextDecoder',
  'FormData', 'Blob', 'File', 'FileReader',
  'Headers', 'Request', 'Response',
  'ReadableStream', 'WritableStream', 'TransformStream',
  'Event', 'EventTarget', 'CustomEvent',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'Performance', 'performance',
  'crypto',
]);

// ---------------------------------------------------------------------------
// JS keywords -- appear before ( or . but are NOT function/variable calls
// Must be excluded from unknown-global flagging
// ---------------------------------------------------------------------------

const JS_KEYWORDS = new Set<string>([
  'if', 'for', 'while', 'do', 'switch', 'try', 'catch', 'finally',
  'return', 'throw', 'break', 'continue', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'in', 'of', 'class', 'extends', 'super', 'this',
  'import', 'export', 'default', 'case', 'yield', 'async', 'await',
  'debugger', 'with', 'static', 'let', 'const', 'var', 'function',
  'true', 'false', 'null',
  // Class method name — appears as `constructor(` in class bodies but is not a global
  'constructor',
]);

// ---------------------------------------------------------------------------
// Statement boundary helper for SCRIPT-04
// ---------------------------------------------------------------------------

/**
 * Scan backwards from pos to find the start of the current statement.
 * Statement boundaries: semicolons, braces, newlines.
 */
function findStatementStart(text: string, pos: number): number {
  for (let i = pos - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ';' || ch === '{' || ch === '}' || ch === '\n') {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Like findStatementStart but only stops at semicolons and newlines (not braces).
 * Used for the Promise combinator check so that inner async calls inside
 * `Promise.all([a.xAsync(), b.yAsync()])` can see the outer Promise context
 * even when `findStatementStart` would stop at the `{`/`}` of an arg literal.
 */
function findLineStart(text: string, pos: number): number {
  for (let i = pos - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ';' || ch === '\n') {
      return i + 1;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// SCRIPT-04: Missing-await check
// T-03-01: linear -- \w+ single char-class repetition, no nested quantifiers
// ---------------------------------------------------------------------------

function checkMissingAwait(
  text: string,
  exclusionRanges: Array<{ start: number; end: number }>
): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const asyncPattern = /\b(\w+Async)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = asyncPattern.exec(text)) !== null) {
    if (isInsideExclusionRange(match.index, exclusionRanges)) continue;

    const fnName = match[1];

    // Scan back to statement start; check context for accepted patterns.
    // Critical (Pitfall 3 from RESEARCH.md): scan from statement start,
    // not just the immediately preceding token, to handle chained calls like:
    //   await base.getTable('X').selectRecordsAsync({})
    const stmtStart = findStatementStart(text, match.index);
    const stmtContext = text.slice(stmtStart, match.index);

    const isAccepted =
      // Has await anywhere in the statement context
      /\bawait\b/.test(stmtContext) ||
      // Is a return expression
      /\breturn\b/.test(stmtContext) ||
      // Is assigned to a variable (const/let/var x = ...)
      /\b(?:const|let|var)\s+\w/.test(stmtContext) ||
      // Followed by .then( chain -- check text after the match
      /\)\s*\.then\s*\(/.test(text.slice(match.index)) ||
      // Inside a Promise combinator call (Promise.all/allSettled/race/any).
      // Uses findLineStart (semicolon/newline only, not braces) so that inner async
      // calls inside Promise.all([a.xAsync(), b.yAsync()]) can see the outer Promise
      // context even when findStatementStart stops at a brace inside an arg literal.
      /\bPromise\s*\.\s*(?:all|allSettled|race|any)\s*\(/.test(
        text.slice(findLineStart(text, match.index), match.index)
      );

    if (!isAccepted) {
      diagnostics.push({
        range: makeRange(text, match.index, match.index + fnName.length),
        message: `'${fnName}' is an async function. Add 'await' before calling it.`,
        severity: LsSeverity.Warning,
        code: 'missing-await',
        source: 'airtable-script',
      });
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// SCRIPT-05: Unknown-global check
// Phase A: build local symbol table
// Phase B: scan for unknown bare identifiers before . or (
// ---------------------------------------------------------------------------

/**
 * Phase A: Build a set of locally-declared identifiers from the text.
 * Initializes from KNOWN_SAFE. Collects:
 *   const/let/var names, function names + params, class names,
 *   for-of loop vars, catch vars, arrow params (best-effort).
 *
 * T-03-01: all declaration patterns use simple character-class repetitions -- linear.
 */
/** Extract simple identifiers from a comma-separated binding list. */
function extractBindings(str: string): string[] {
  return str.split(',')
    .map(s => s.trim().replace(/^\.\.\./, '').replace(/\s*[=:].*$/, '').trim())
    .filter(s => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s));
}

/** Extract identifiers from an array or object destructuring pattern. */
function extractDestructuredBindings(pattern: string): string[] {
  const inner = pattern.replace(/^[\[{]/, '').replace(/[\]}]$/, '');
  return extractBindings(inner);
}

function buildLocalSymbols(text: string): Set<string> {
  const symbols = new Set<string>(KNOWN_SAFE);

  // const/let/var x or const/let/var [a, b] or const/let/var {a, b}
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*|[\[{][^\]};]*[\]}])/g)) {
    const binding = m[1];
    if (/^[a-zA-Z_$]/.test(binding)) {
      symbols.add(binding);
    } else {
      for (const id of extractDestructuredBindings(binding)) symbols.add(id);
    }
  }

  // function foo( -- collect function name and parameters
  for (const m of text.matchAll(/\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)) {
    symbols.add(m[1]);
    const parenStart = m.index + m[0].length - 1;
    const parenEnd = text.indexOf(')', parenStart);
    if (parenEnd !== -1) {
      for (const id of extractBindings(text.slice(parenStart + 1, parenEnd))) symbols.add(id);
    }
  }

  // class Foo
  for (const m of text.matchAll(/\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g)) {
    symbols.add(m[1]);
  }

  // for (const/let/var item of/in ...) or for (const/let/var [a, b] of ...)
  for (const m of text.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*|[\[{][^\]};]*[\]}])\s+(?:of|in)\b/g)) {
    const binding = m[1];
    if (/^[a-zA-Z_$]/.test(binding)) {
      symbols.add(binding);
    } else {
      for (const id of extractDestructuredBindings(binding)) symbols.add(id);
    }
  }

  // catch (e)
  for (const m of text.matchAll(/\bcatch\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/g)) {
    symbols.add(m[1]);
  }

  // Arrow function params — single param: identifier =>
  for (const m of text.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/g)) {
    if (!JS_KEYWORDS.has(m[1])) symbols.add(m[1]);
  }

  // Arrow function params — multi-param: (param1, param2) =>
  for (const m of text.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const id of extractBindings(m[1])) symbols.add(id);
  }

  return symbols;
}

/**
 * Phase B: Scan for unknown bare identifiers followed by . or (
 * that are not preceded by . (not a method access),
 * not in KNOWN_SAFE, not in JS_KEYWORDS, not in local symbol set.
 *
 * T-03-01: linear pattern -- identifier character-class repetition, no nesting.
 */
function checkUnknownGlobals(
  text: string,
  exclusionRanges: Array<{ start: number; end: number }>
): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const localSymbols = buildLocalSymbols(text);

  // T-03-01: single identifier character-class repetition followed by . or (
  const identBeforeDotOrParenRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[.(]/g;
  let match: RegExpExecArray | null;

  while ((match = identBeforeDotOrParenRegex.exec(text)) !== null) {
    if (isInsideExclusionRange(match.index, exclusionRanges)) continue;

    const ident = match[1];

    // Skip JS keywords (appear before ( but are not calls)
    if (JS_KEYWORDS.has(ident)) continue;

    // Skip if in local symbols set (Airtable globals + JS built-ins + locally-declared)
    if (localSymbols.has(ident)) continue;

    // Skip if preceded by a dot -- this is a method access, not a bare global
    let precIdx = match.index - 1;
    while (precIdx >= 0 && (text[precIdx] === ' ' || text[precIdx] === '\t')) {
      precIdx--;
    }
    if (precIdx >= 0 && text[precIdx] === '.') continue;

    diagnostics.push({
      range: makeRange(text, match.index, match.index + ident.length),
      message: `'${ident}' is not a known global. Declare it locally or check the spelling.`,
      severity: LsSeverity.Warning,
      code: 'unknown-global',
      source: 'airtable-script',
    });
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

export function scriptDiagnostics(text: string, _uri?: string): LsDiagnostic[] {
  const exclusionRanges = getExclusionRanges(text);
  return [
    ...checkMissingAwait(text, exclusionRanges),
    ...checkUnknownGlobals(text, exclusionRanges),
  ];
}

