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
// Position helpers (from formula diagnostics.ts lines 24-38, indexed)
// ---------------------------------------------------------------------------

// The newline offsets are found once per document (newlineOffsets) and each
// position is a binary search over them. Walking from offset 0 for every range,
// as this used to, made N diagnostics cost O(N x text).

function newlineOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) offsets.push(i);
  return offsets;
}

function offsetToPosition(
  text: string,
  newlines: number[],
  offset: number
): { line: number; character: number } {
  // Count the newlines before min(offset, text.length), as the old walk did.
  const limit = Math.min(offset, text.length);
  let lo = 0;
  let hi = newlines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (newlines[mid] < limit) lo = mid + 1;
    else hi = mid;
  }
  const lastNewline = lo === 0 ? -1 : newlines[lo - 1];
  return { line: lo, character: offset - lastNewline - 1 };
}

function makeRange(text: string, newlines: number[], start: number, end: number): LsRange {
  return {
    start: offsetToPosition(text, newlines, start),
    end: offsetToPosition(text, newlines, end),
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

// getExclusionRanges emits ranges sorted and disjoint, so the only one that can
// contain position is the last one starting at or before it: a binary search,
// not a walk over every range for every match.
function isInsideExclusionRange(
  position: number,
  ranges: Array<{ start: number; end: number }>
): boolean {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid].start <= position) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && position < ranges[lo - 1].end;
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
  'if', 'else', 'for', 'while', 'do', 'switch', 'try', 'catch', 'finally',
  'return', 'throw', 'break', 'continue', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'in', 'of', 'class', 'extends', 'super', 'this',
  'import', 'export', 'default', 'case', 'yield', 'async', 'await',
  'debugger', 'with', 'static', 'let', 'const', 'var', 'function',
  'true', 'false', 'null',
  // Class method name — appears as `constructor(` in class bodies but is not a global
  'constructor',
]);

// ---------------------------------------------------------------------------
// Statement boundary helpers for SCRIPT-04
// ---------------------------------------------------------------------------

/** Statement boundaries: semicolons, braces, newlines. */
function isStatementBoundary(ch: string): boolean {
  return ch === ';' || ch === '{' || ch === '}' || ch === '\n';
}

/**
 * Like isStatementBoundary but only semicolons and newlines (not braces).
 * Used for the Promise combinator check so that inner async calls inside
 * `Promise.all([a.xAsync(), b.yAsync()])` can see the outer Promise context
 * even when the statement would stop at the `{`/`}` of an arg literal.
 */
function isLineBoundary(ch: string): boolean {
  return ch === ';' || ch === '\n';
}

/**
 * Context for a run of ascending positions: for each position, the end offset of
 * the first match of each pattern in the segment containing it (Infinity when
 * none), where a segment runs from just past the previous boundary character
 * (where the old findStatementStart / findLineStart stopped) to the next one.
 *
 * "pattern occurs in text.slice(segmentStart, pos)" is then "its end <= pos".
 * Each segment is sliced and searched once, so a long statement holding many
 * calls costs O(segment), not O(calls x segment) as walking back and re-slicing
 * per call did. The equivalence relies on what the patterns and positions are:
 * every pos is the start of a \w+Async name (a word character after a non-word
 * one), so no trailing \b of a match can fall exactly on pos; no pattern looks
 * past its last character otherwise; and a later match of these patterns never
 * ends before an earlier one, so the first match is the first to end.
 */
function segmentScanner(
  text: string,
  isBoundary: (ch: string) => boolean,
  patterns: RegExp[]
): (pos: number) => number[] {
  let scanned = 0;
  let start = 0;
  let segmentStart = -1;
  let firstEnds: number[] = [];
  return (pos) => {
    for (; scanned < pos; scanned++) if (isBoundary(text[scanned])) start = scanned + 1;
    if (start !== segmentStart) {
      segmentStart = start;
      let end = pos;
      while (end < text.length && !isBoundary(text[end])) end++;
      const segment = text.slice(start, end);
      firstEnds = patterns.map((pattern) => {
        const m = pattern.exec(segment);
        return m ? start + m.index + m[0].length : Infinity;
      });
    }
    return firstEnds;
  };
}

/** Start index of the last match of a global regex in text, or -1. */
function lastMatchIndex(text: string, pattern: RegExp): number {
  let last = -1;
  for (const m of text.matchAll(pattern)) last = m.index;
  return last;
}

// ---------------------------------------------------------------------------
// SCRIPT-04: Missing-await check
// T-03-01: linear -- \w+ single char-class repetition, no nested quantifiers
// ---------------------------------------------------------------------------

function checkMissingAwait(
  text: string,
  exclusionRanges: Array<{ start: number; end: number }>,
  newlines: number[]
): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const asyncPattern = /\b(\w+Async)\s*\(/g;
  let match: RegExpExecArray | null;

  // "A ).then( occurs at or after this call" holds exactly when the LAST ).then(
  // in the text starts at or after it. Found once here, so each call below is an
  // O(1) compare instead of a rescan of the rest of the text.
  const lastThen = lastMatchIndex(text, /\)\s*\.then\s*\(/g);

  // Critical (Pitfall 3 from RESEARCH.md): check from statement start,
  // not just the immediately preceding token, to handle chained calls like:
  //   await base.getTable('X').selectRecordsAsync({})
  const statement = segmentScanner(text, isStatementBoundary, [
    /\bawait\b/,
    /\breturn\b/,
    /\b(?:const|let|var)\s+\w/,
  ]);
  // Line (semicolon/newline only, not braces) so that inner async calls inside
  // Promise.all([a.xAsync(), b.yAsync()]) can see the outer Promise context even
  // when the statement stops at a brace inside an arg literal.
  const line = segmentScanner(text, isLineBoundary, [
    /\bPromise\s*\.\s*(?:all|allSettled|race|any)\s*\(/,
  ]);

  while ((match = asyncPattern.exec(text)) !== null) {
    if (isInsideExclusionRange(match.index, exclusionRanges)) continue;

    const fnName = match[1];
    const [awaitEnd, returnEnd, declarationEnd] = statement(match.index);
    const [promiseEnd] = line(match.index);

    // Each "<= match.index" reads "occurs between the statement (line) start and the call".
    const isAccepted =
      // Has await anywhere in the statement context
      awaitEnd <= match.index ||
      // Is a return expression
      returnEnd <= match.index ||
      // Is assigned to a variable (const/let/var x = ...)
      declarationEnd <= match.index ||
      // Followed by .then( chain -- one starts at or after the match
      lastThen >= match.index ||
      // Inside a Promise combinator call (Promise.all/allSettled/race/any)
      promiseEnd <= match.index;

    if (!isAccepted) {
      diagnostics.push({
        range: makeRange(text, newlines, match.index, match.index + fnName.length),
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

// ---------------------------------------------------------------------------
// Identifier scan: the matches of /\b([a-zA-Z_$][a-zA-Z0-9_$]*)<suffix>/g, in
// linear time.
//
// As a global regex that pattern is O(n^2) on a long identifier run such as
// 'a$'.repeat(n): `$` is an identifier character but not a \w one, so \b holds
// at every a/$ transition and each attempt scans to the end of the run before
// failing. Here each maximal run of identifier characters is visited once.
// Inside a run the regex can start only where \b holds and the character may
// begin an identifier; from any such start the identifier extends to the end of
// the run and the suffix is tried at the same place, so the leftmost start
// decides the whole run. Each suffix used here is \s* followed by a character
// that is neither whitespace nor an identifier character, so a shorter
// identifier (backtracking into the run) could never have matched instead.
// ---------------------------------------------------------------------------

/** [a-zA-Z0-9_]: what \b treats as a word character. NaN (out of range) is not. */
function isWordCode(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/** [a-zA-Z_$]: a character that may begin an identifier. */
function isIdentStartCode(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
}

/** [a-zA-Z0-9_$]: a character that may continue an identifier. */
function isIdentCode(c: number): boolean {
  return isWordCode(c) || c === 36;
}

/**
 * Group 1 of every match of HEAD([a-zA-Z_$][a-zA-Z0-9_$]*|[\[{][^\]};]*[\]}])TAIL,
 * in order, as text.matchAll would give it -- in linear time.
 *
 * As a regex, [^\]};]* is rescanned from every `[`/`{` it tries up to the same
 * stop character, so 'const ['.repeat(n) was O(n^2). Here the next stop is
 * remembered (the queries only move forward). `head` is global and ends in \s+,
 * so no match can start inside a head match; after a match the head resumes
 * where it ended, as the regex's lastIndex would. `tail` is sticky or null.
 * Its outcome depends only on the binding end, which many heads can share (many
 * `[` before one `]`), so it is tried once per end: otherwise a failing tail
 * after a long whitespace run was rescanned once per head.
 */
function declarationBindings(text: string, head: RegExp, tail: RegExp | null): string[] {
  const bindings: string[] = [];
  let stop = -1; // first ] } or ; at or after the last query (text.length: none)
  const afterTail = new Map<number, number>(); // binding end -> match end, or -1 if the tail fails
  head.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = head.exec(text)) !== null) {
    const at = m.index + m[0].length;
    let end = -1;
    if (isIdentStartCode(text.charCodeAt(at))) {
      end = at + 1;
      while (isIdentCode(text.charCodeAt(end))) end++;
    } else if (text[at] === '[' || text[at] === '{') {
      if (stop < at + 1) {
        stop = at + 1;
        while (stop < text.length && text[stop] !== ']' && text[stop] !== '}' && text[stop] !== ';') stop++;
      }
      if (stop < text.length && text[stop] !== ';') end = stop + 1;
    }
    if (end === -1) continue;
    let matchEnd = end;
    if (tail) {
      let after = afterTail.get(end);
      if (after === undefined) {
        tail.lastIndex = end;
        after = tail.test(text) ? tail.lastIndex : -1;
        afterTail.set(end, after);
      }
      if (after === -1) continue;
      matchEnd = after;
    }
    bindings.push(text.slice(at, end));
    head.lastIndex = matchEnd;
  }
  return bindings;
}

/**
 * Group 1 (the parameter text) of every match of
 * /(?<![a-zA-Z0-9_$])\(([^)]*)\)\s*=>/g, in order -- in linear time.
 *
 * As a regex, [^)]* scanned from every '(' to the next ')', so a run of
 * unmatched '(' was O(n^2). Every '(' since the previous ')' reaches the same
 * ')' and the same \s*=> test, so the test runs once per ')', and the match
 * starts at the leftmost eligible '(' in that stretch, which is where the
 * regex's left-to-right scan succeeds first. Each '(' and ')' is visited once.
 */
function arrowParamLists(text: string): string[] {
  const lists: string[] = [];
  const arrow = /\s*=>/y;
  let resumeAt = 0; // the regex's lastIndex
  let segmentStart = 0; // just past the previous ')'
  let open = text.indexOf('(');
  for (let close = text.indexOf(')'); close !== -1; close = text.indexOf(')', close + 1)) {
    const from = Math.max(segmentStart, resumeAt);
    segmentStart = close + 1;
    while (open !== -1 && open < from) open = text.indexOf('(', open + 1);
    // Leftmost '(' before this ')' not preceded by an identifier character.
    while (open !== -1 && open < close && isIdentCode(text.charCodeAt(open - 1))) {
      open = text.indexOf('(', open + 1);
    }
    if (open === -1 || open > close) continue;
    arrow.lastIndex = close + 1;
    if (!arrow.test(text)) continue;
    lists.push(text.slice(open + 1, close));
    resumeAt = arrow.lastIndex;
  }
  return lists;
}

/**
 * Same index and identifier, in the same order, as
 * text.matchAll(new RegExp(String.raw`\b([a-zA-Z_$][a-zA-Z0-9_$]*)` + suffix.source, 'g')).
 * `suffix` must be sticky (y) and of the form \s*<non-identifier, non-space char>.
 */
function identifierMatches(text: string, suffix: RegExp): Array<{ index: number; ident: string }> {
  const found: Array<{ index: number; ident: string }> = [];
  let resumeAt = 0; // the regex's lastIndex: a match never starts inside the previous one
  for (const run of text.matchAll(/[a-zA-Z0-9_$]+/g)) {
    const runEnd = run.index + run[0].length;
    let start = -1;
    for (let p = Math.max(run.index, resumeAt); p < runEnd; p++) {
      const c = text.charCodeAt(p);
      if (isIdentStartCode(c) && isWordCode(text.charCodeAt(p - 1)) !== isWordCode(c)) {
        start = p;
        break;
      }
    }
    if (start === -1) continue;
    suffix.lastIndex = runEnd;
    if (!suffix.test(text)) continue;
    found.push({ index: start, ident: text.slice(start, runEnd) });
    resumeAt = suffix.lastIndex;
  }
  return found;
}

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
    .map(s => stripDefaultOrType(s.trim().replace(/^\.\.\./, '')).trim())
    .filter(s => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s));
}

/**
 * s.replace(/\s*[=:].*$/, ''), in linear time. As a regex, every position of a
 * long whitespace run retried \s* to the end of that run, so '(a' + ' '.repeat(n)
 * + 'b) =>' was O(n^2). `.*$` (no m flag) must reach the end of s without
 * crossing a line terminator, so only a [=:] after the last one can match, and
 * the leftmost match starts at the whitespace run just before the first of those.
 */
function stripDefaultOrType(s: string): string {
  // Native scans only: this runs on every piece of every parameter list, and the
  // common piece has no [=:] at all.
  let at = s.search(/[=:]/);
  if (at === -1) return s;
  const from =
    Math.max(s.lastIndexOf('\n'), s.lastIndexOf('\r'), s.lastIndexOf('\u2028'), s.lastIndexOf('\u2029')) + 1;
  if (at < from) {
    const after = /[=:]/g;
    after.lastIndex = from;
    const m = after.exec(s);
    if (m === null) return s;
    at = m.index;
  }
  // trimEnd strips exactly the \s set (WhiteSpace + LineTerminator), natively.
  return s.slice(0, at).trimEnd();
}

/**
 * extractBindings(text.slice(start, end)) for a slice holding no ',' (a single
 * piece), for a run of calls with ascending starts that share one end: the
 * first pieces of function heads reaching the same ')' with no ',' between.
 *
 * Each such piece is a suffix of the previous one, so doing it per head
 * re-scanned the shared tail -- the trailing whitespace, the [=:] search, the
 * last line terminator, the whitespace before the [=:] -- once per head
 * ('function f('.repeat(9090) + 100k spaces + '=1)' took ~1.3-2 s even with
 * native scans). What depends only on the end is computed once per end; each
 * call then costs its own leading whitespace and identifier run. The steps
 * mirror extractBindings exactly: trim, drop a leading '...',
 * stripDefaultOrType, trim, identifier test.
 */
function makeSinglePieceBindings(text: string): (start: number, end: number) => string[] {
  let tailEnd = -1; // the end the values below were computed for
  let trimmedEnd = 0; // end of the piece after trimming trailing whitespace
  let lastLine = -1; // last line terminator in [first start, trimmedEnd), or -1
  let cutAfterLine = -1; // first [=:] in (lastLine, trimmedEnd), or -1
  let cut = -2; // first [=:] at or after the last start with no line terminator in its piece (-1: none)
  let firstStart = 0;
  const spaceBefore = new Map<number, number>(); // [=:] index -> start of the whitespace run before it
  const skipSpace = (from: number, to: number) => {
    const s = text.slice(from, to);
    return from + (s.length - s.trimStart().length);
  };
  return (start, end) => {
    if (end !== tailEnd) {
      tailEnd = end;
      firstStart = start;
      trimmedEnd = start + text.slice(start, end).trimEnd().length;
      const body = text.slice(start, trimmedEnd);
      const line = Math.max(
        body.lastIndexOf('\n'), body.lastIndexOf('\r'), body.lastIndexOf('\u2028'), body.lastIndexOf('\u2029'));
      lastLine = line === -1 ? -1 : start + line;
      const afterLine = lastLine === -1 ? -1 : text.slice(lastLine + 1, trimmedEnd).search(/[=:]/);
      cutAfterLine = afterLine === -1 ? -1 : lastLine + 1 + afterLine;
      cut = -2;
      spaceBefore.clear();
    }
    // trim(), then drop a leading '...'
    const b0 = skipSpace(start, trimmedEnd);
    if (b0 >= trimmedEnd) return [];
    const b = text.startsWith('...', b0) && b0 + 3 <= trimmedEnd ? b0 + 3 : b0;
    // stripDefaultOrType: the first [=:] after the piece's last line terminator
    let at: number;
    if (lastLine >= b) {
      at = cutAfterLine;
    } else {
      if (cut !== -1 && cut < b) {
        const found = text.slice(b, trimmedEnd).search(/[=:]/);
        cut = found === -1 ? -1 : b + found;
      }
      at = cut;
    }
    let stop = trimmedEnd;
    if (at !== -1) {
      let space = spaceBefore.get(at);
      if (space === undefined) {
        space = firstStart + text.slice(firstStart, at).trimEnd().length;
        spaceBefore.set(at, space);
      }
      stop = Math.max(b, space);
    }
    // trim() again, then the identifier test
    const id = skipSpace(b, stop);
    if (id >= stop || !isIdentStartCode(text.charCodeAt(id))) return [];
    for (let i = id + 1; i < stop; i++) if (!isIdentCode(text.charCodeAt(i))) return [];
    return [text.slice(id, stop)];
  };
}

/** Extract identifiers from an array or object destructuring pattern. */
function extractDestructuredBindings(pattern: string): string[] {
  const inner = pattern.replace(/^[\[{]/, '').replace(/[\]}]$/, '');
  return extractBindings(inner);
}

function buildLocalSymbols(text: string): Set<string> {
  const symbols = new Set<string>(KNOWN_SAFE);

  // const/let/var x or const/let/var [a, b] or const/let/var {a, b}
  // (was /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*|[\[{][^\]};]*[\]}])/g)
  for (const binding of declarationBindings(text, /\b(?:const|let|var)\s+/g, null)) {
    if (/^[a-zA-Z_$]/.test(binding)) {
      symbols.add(binding);
    } else {
      for (const id of extractDestructuredBindings(binding)) symbols.add(id);
    }
  }

  // Multi-declaration continuations: const a = 1, b = 2, c = 3
  // The primary regex captures only the first declarator; this catches the rest.
  // (?![>=]) excludes == === and => (arrow functions / comparisons).
  for (const m of text.matchAll(/,\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=(?![>=])/g)) {
    if (!JS_KEYWORDS.has(m[1])) symbols.add(m[1]);
  }

  // function foo( -- collect function name and parameters
  // Parameters run from the '(' to the next ')'. Heads that reach the same ')'
  // have nested parameter slices (each a suffix of the one before), and every
  // piece after a later head's first ',' is a piece the earlier head already
  // added -- so a later head adds only its first piece. Before, each slice went
  // through split(',') again: O(heads x commas). The next ')' and ',' are found
  // with forward-only cursors, so neither is rescanned per head, and a later
  // head's first piece goes through singlePieceBindings, which shares the work
  // that depends only on where the piece ends.
  let close = -2; // -2: not looked up yet; -1: no ')' at or after the last lookup
  let comma = -2;
  let listedClose = -1; // the ')' whose whole parameter list has been added
  const singlePieceBindings = makeSinglePieceBindings(text);
  for (const m of text.matchAll(/\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)) {
    symbols.add(m[1]);
    const parenStart = m.index + m[0].length - 1;
    if (close !== -1 && close < parenStart) close = text.indexOf(')', parenStart);
    const parenEnd = close;
    if (parenEnd !== -1) {
      if (parenEnd === listedClose) {
        if (comma !== -1 && comma <= parenStart) comma = text.indexOf(',', parenStart + 1);
        const end = comma !== -1 && comma < parenEnd ? comma : parenEnd;
        for (const id of singlePieceBindings(parenStart + 1, end)) symbols.add(id);
      } else {
        for (const id of extractBindings(text.slice(parenStart + 1, parenEnd))) symbols.add(id);
      }
      listedClose = parenEnd;
    }
  }

  // class Foo
  for (const m of text.matchAll(/\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g)) {
    symbols.add(m[1]);
  }

  // for (const/let/var item of/in ...) or for (const/let/var [a, b] of ...)
  // (was /\bfor\s*\(\s*(?:const|let|var)\s+(<ident>|<destructure>)\s+(?:of|in)\b/g)
  for (const binding of declarationBindings(text, /\bfor\s*\(\s*(?:const|let|var)\s+/g, /\s+(?:of|in)\b/y)) {
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
  // (was /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/g; see identifierMatches)
  for (const { ident } of identifierMatches(text, /\s*=>/y)) {
    if (!JS_KEYWORDS.has(ident)) symbols.add(ident);
  }

  // Arrow function params — multi-param: (param1, param2) =>
  // Negative lookbehind excludes the outer call-paren in map((x) => ...) so the
  // regex anchors on the arrow-param ( not the preceding map( or filter( etc.
  // (was /(?<![a-zA-Z0-9_$])\(([^)]*)\)\s*=>/g; see arrowParamLists)
  for (const params of arrowParamLists(text)) {
    for (const id of extractBindings(params)) symbols.add(id);
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
  exclusionRanges: Array<{ start: number; end: number }>,
  newlines: number[]
): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const localSymbols = buildLocalSymbols(text);

  // Identifier followed by . or ( -- the matches of
  // /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[.(]/g, found in linear time (identifierMatches).
  for (const match of identifierMatches(text, /\s*[.(]/y)) {
    if (isInsideExclusionRange(match.index, exclusionRanges)) continue;

    const ident = match.ident;

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
      range: makeRange(text, newlines, match.index, match.index + ident.length),
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
  const newlines = newlineOffsets(text);
  return [
    ...checkMissingAwait(text, exclusionRanges, newlines),
    ...checkUnknownGlobals(text, exclusionRanges, newlines),
  ];
}

