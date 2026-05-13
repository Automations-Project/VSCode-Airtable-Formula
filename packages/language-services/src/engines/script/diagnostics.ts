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
// Exclusion ranges helper (from formula diagnostics.ts lines 49-91,
// extended with template-literal exclusion for backtick strings)
// ---------------------------------------------------------------------------

function getExclusionRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  // Field references: {...}
  const fieldRefRegex = /\{[^{}]*\}/g;
  let match: RegExpExecArray | null;
  while ((match = fieldRefRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Double-quoted strings
  const doubleQuoteRegex = /"(?:[^"\\]|\\.)*"/g;
  while ((match = doubleQuoteRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Single-quoted strings
  const singleQuoteRegex = /'(?:[^'\\]|\\.)*'/g;
  while ((match = singleQuoteRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Template literals -- safe negated-class pattern (T-03-01)
  // Alternation: non-backtick-non-backslash OR backslash+any -- linear, no ambiguity
  const templateLiteralRegex = /`(?:[^`\\]|\\.)*`/g;
  while ((match = templateLiteralRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Single-line comments: //...
  const singleLineCommentRegex = /\/\/.*/g;
  while ((match = singleLineCommentRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Block comments
  const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
  while ((match = blockCommentRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
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
      /\)\s*\.then\s*\(/.test(text.slice(match.index));

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
function buildLocalSymbols(text: string): Set<string> {
  const symbols = new Set<string>(KNOWN_SAFE);

  // const/let/var x (best-effort simple name only -- destructuring not detected)
  const varDeclRegex = /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = varDeclRegex.exec(text)) !== null) {
    symbols.add(match[1]);
  }

  // function foo( -- collect function name and parameters
  const funcDeclRegex = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  while ((match = funcDeclRegex.exec(text)) !== null) {
    symbols.add(match[1]);
    // Collect function parameters from the parameter list
    const parenStart = match.index + match[0].length - 1; // position of opening (
    const parenEnd = text.indexOf(')', parenStart);
    if (parenEnd !== -1) {
      const paramStr = text.slice(parenStart + 1, parenEnd);
      const params = paramStr.split(',');
      for (const param of params) {
        const trimmed = param.trim().replace(/\s*=.*$/, ''); // strip default values
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
          symbols.add(trimmed);
        }
      }
    }
  }

  // class Foo
  const classDeclRegex = /\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  while ((match = classDeclRegex.exec(text)) !== null) {
    symbols.add(match[1]);
  }

  // for (const/let/var item of ...)
  const forOfRegex = /\bfor\s*\(\s*(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+of\b/g;
  while ((match = forOfRegex.exec(text)) !== null) {
    symbols.add(match[1]);
  }

  // catch (e)
  const catchRegex = /\bcatch\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/g;
  while ((match = catchRegex.exec(text)) !== null) {
    symbols.add(match[1]);
  }

  // Arrow function params -- best-effort for single and multi-param forms:
  // Single param: identifier =>  (T-03-01: linear identifier pattern)
  const singleArrowRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/g;
  while ((match = singleArrowRegex.exec(text)) !== null) {
    if (!JS_KEYWORDS.has(match[1])) {
      symbols.add(match[1]);
    }
  }

  // Multi-param: (param1, param2) =>  (T-03-01: [^)] is linear negated-class)
  const multiArrowRegex = /\(([^)]*)\)\s*=>/g;
  while ((match = multiArrowRegex.exec(text)) !== null) {
    const paramStr = match[1];
    const params = paramStr.split(',');
    for (const param of params) {
      const trimmed = param.trim().replace(/\s*=.*$/, ''); // strip default values
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
        symbols.add(trimmed);
      }
    }
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

