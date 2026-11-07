import type { LsDiagnostic, LsRange } from '../../types.js';
import { LsSeverity } from '../../types.js';
import { SCRIPT_GLOBAL_NAMES } from '../script/registry.js';

// ---------------------------------------------------------------------------
// Position helpers (same as script/diagnostics.ts)
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
// Exclusion ranges helper — single-pass tokenizer (same fix as script/diagnostics.ts).
// Comments consume quote chars before string scanners see them, preventing a
// lone apostrophe in a // comment from anchoring a fake multi-line "string".
// Single/double-quoted strings stop at newlines; template literals may span them.
// ---------------------------------------------------------------------------

function getExclusionRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const len = text.length;
  let i = 0;

  while (i < len) {
    const ch = text[i];

    if (ch === '/' && i + 1 < len && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const commentEnd = end !== -1 ? end + 2 : len;
      ranges.push({ start: i, end: commentEnd });
      i = commentEnd;
      continue;
    }

    if (ch === '/' && i + 1 < len && text[i + 1] === '/') {
      let j = i + 2;
      while (j < len && text[j] !== '\n') j++;
      ranges.push({ start: i, end: j });
      i = j;
      continue;
    }

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
// JS keywords — appear before ( or . but are NOT function/variable calls.
// ---------------------------------------------------------------------------

const JS_KEYWORDS = new Set<string>([
  'if', 'else', 'for', 'while', 'do', 'switch', 'try', 'catch', 'finally',
  'return', 'throw', 'break', 'continue', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'in', 'of', 'class', 'extends', 'super', 'this',
  'import', 'export', 'default', 'case', 'yield', 'async', 'await',
  'debugger', 'with', 'static', 'let', 'const', 'var', 'function',
  'true', 'false', 'null',
  'constructor',
]);

// ---------------------------------------------------------------------------
// Automation globals allowlist (same JS built-ins as script, plus fetch).
// ---------------------------------------------------------------------------

const KNOWN_SAFE = new Set<string>([
  ...SCRIPT_GLOBAL_NAMES,
  'console', 'Math', 'JSON', 'Date', 'Promise', 'Array', 'Object', 'Error',
  'parseInt', 'parseFloat', 'setTimeout', 'clearTimeout',
  'undefined', 'NaN', 'Infinity', 'globalThis',
  'eval', 'isNaN', 'isFinite',
  'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',
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
  'setInterval', 'clearInterval', 'queueMicrotask',
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
  'fetch',
]);

// ---------------------------------------------------------------------------
// Local symbol extractor helpers
// ---------------------------------------------------------------------------

function extractBindings(str: string): string[] {
  return str.split(',')
    .map(s => s.trim().replace(/^\.\.\./, '').replace(/\s*[=:].*$/, '').trim())
    .filter(s => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s));
}

function extractDestructuredBindings(pattern: string): string[] {
  const inner = pattern.replace(/^[\[{]/, '').replace(/[\]}]$/, '');
  return extractBindings(inner);
}

function buildLocalSymbols(text: string): Set<string> {
  const symbols = new Set<string>(KNOWN_SAFE);

  for (const m of text.matchAll(/\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*|[\[{][^\]};]*[\]}])/g)) {
    const binding = m[1];
    if (/^[a-zA-Z_$]/.test(binding)) {
      symbols.add(binding);
    } else {
      for (const id of extractDestructuredBindings(binding)) symbols.add(id);
    }
  }

  // Multi-declaration continuations: const a = 1, b = 2, c = 3
  // (?![>=]) excludes == === and => (arrow functions / comparisons).
  for (const m of text.matchAll(/,\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=(?![>=])/g)) {
    if (!JS_KEYWORDS.has(m[1])) symbols.add(m[1]);
  }

  for (const m of text.matchAll(/\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)) {
    symbols.add(m[1]);
    const parenStart = m.index! + m[0].length - 1;
    const parenEnd = text.indexOf(')', parenStart);
    if (parenEnd !== -1) {
      for (const id of extractBindings(text.slice(parenStart + 1, parenEnd))) symbols.add(id);
    }
  }

  for (const m of text.matchAll(/\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g)) {
    symbols.add(m[1]);
  }

  for (const m of text.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*|[\[{][^\]};]*[\]}])\s+(?:of|in)\b/g)) {
    const binding = m[1];
    if (/^[a-zA-Z_$]/.test(binding)) {
      symbols.add(binding);
    } else {
      for (const id of extractDestructuredBindings(binding)) symbols.add(id);
    }
  }

  for (const m of text.matchAll(/\bcatch\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/g)) {
    symbols.add(m[1]);
  }

  for (const m of text.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/g)) {
    if (!JS_KEYWORDS.has(m[1])) symbols.add(m[1]);
  }

  // Negative lookbehind excludes the outer call-paren in map((x) => ...).
  // [^()]* (not [^)]*): a candidate stops at the next paren of either kind, so a
  // run of unmatched '(' cannot make each of them scan to the end of the text.
  for (const m of text.matchAll(/(?<![a-zA-Z0-9_$])\(([^()]*)\)\s*=>/g)) {
    for (const id of extractBindings(m[1])) symbols.add(id);
  }

  return symbols;
}

// ---------------------------------------------------------------------------
// Statement boundary helpers for missing-await check
// ---------------------------------------------------------------------------

function isStatementBoundary(ch: string): boolean {
  return ch === ';' || ch === '{' || ch === '}' || ch === '\n';
}

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
  for (const m of text.matchAll(pattern)) last = m.index!;
  return last;
}

// ---------------------------------------------------------------------------
// Missing-await check (D-04)
// ---------------------------------------------------------------------------

function checkMissingAwait(
  text: string,
  exclusionRanges: Array<{ start: number; end: number }>,
  newlines: number[]
): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];

  // "A ).then( occurs at or after this call" holds exactly when the LAST ).then(
  // in the text starts at or after it. Found once here, so each call below is an
  // O(1) compare instead of a rescan of the rest of the text.
  const lastThen = lastMatchIndex(text, /\)\s*\.then\s*\(/g);
  const statement = segmentScanner(text, isStatementBoundary, [
    /\bawait\b/,
    /\breturn\b/,
    /\b(?:const|let|var)\s+\w/,
  ]);
  const line = segmentScanner(text, isLineBoundary, [
    /\bPromise\s*\.\s*(?:all|allSettled|race|any)\s*\(/,
  ]);

  for (const match of text.matchAll(/\b(\w+Async)\s*\(/g)) {
    if (isInsideExclusionRange(match.index!, exclusionRanges)) continue;

    const fnName = match[1];
    const at = match.index!;
    const [awaitEnd, returnEnd, declarationEnd] = statement(at);
    const [promiseEnd] = line(at);

    const isAccepted =
      awaitEnd <= at ||
      returnEnd <= at ||
      declarationEnd <= at ||
      lastThen >= at ||
      promiseEnd <= at;

    if (!isAccepted) {
      diagnostics.push({
        range: makeRange(text, newlines, at, at + fnName.length),
        message: `'${fnName}' is an async function. Add 'await' before calling it.`,
        severity: LsSeverity.Warning,
        code: 'missing-await',
        source: 'airtable-automation',
      });
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Unknown-global check (D-04)
// ---------------------------------------------------------------------------

function checkUnknownGlobals(
  text: string,
  exclusionRanges: Array<{ start: number; end: number }>,
  newlines: number[]
): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const localSymbols = buildLocalSymbols(text);

  for (const match of text.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[.(]/g)) {
    if (isInsideExclusionRange(match.index!, exclusionRanges)) continue;

    const ident = match[1];
    if (JS_KEYWORDS.has(ident)) continue;
    if (localSymbols.has(ident)) continue;

    let precIdx = match.index! - 1;
    while (precIdx >= 0 && (text[precIdx] === ' ' || text[precIdx] === '\t')) precIdx--;
    if (precIdx >= 0 && text[precIdx] === '.') continue;

    diagnostics.push({
      range: makeRange(text, newlines, match.index!, match.index! + ident.length),
      message: `'${ident}' is not a known global. Declare it locally or check the spelling.`,
      severity: LsSeverity.Warning,
      code: 'unknown-global',
      source: 'airtable-automation',
    });
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Forbidden patterns: APIs absent from Automation Scripts.
// All patterns are linear (T-04-05): \b word boundary, \w/\s char-class only.
// Method patterns include \s*\( to match calls but not property accesses
// (e.g. output.table( is flagged; output.tableData is not).
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\bcursor\b/g,
    message: 'cursor is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
  {
    pattern: /\bsession\b/g,
    message: 'session is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
  {
    pattern: /\bremoteFetchAsync\b/g,
    message: 'remoteFetchAsync is not available in Automation Scripts — use fetch() instead.',
  },
  {
    pattern: /\binput\.textAsync\s*\(/g,
    message: 'input.textAsync() is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
  {
    pattern: /\binput\.buttonsAsync\s*\(/g,
    message: 'input.buttonsAsync() is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
  {
    pattern: /\binput\.tableAsync\s*\(/g,
    message: 'input.tableAsync() is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
  {
    pattern: /\binput\.viewAsync\s*\(/g,
    message: 'input.viewAsync() is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
  {
    pattern: /\binput\.fieldAsync\s*\(/g,
    message: 'input.fieldAsync() is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
  {
    pattern: /\binput\.recordAsync\s*\(/g,
    message: 'input.recordAsync() is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
  {
    pattern: /\binput\.fileAsync\s*\(/g,
    message: 'input.fileAsync() is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
  {
    pattern: /\boutput\.text\s*\(/g,
    message: 'output.text() is only available in Airtable Scripting Extension — use output.set() to pass data to subsequent steps.',
  },
  {
    pattern: /\boutput\.markdown\s*\(/g,
    message: 'output.markdown() is only available in Airtable Scripting Extension — use output.set() to pass data to subsequent steps.',
  },
  {
    pattern: /\boutput\.table\s*\(/g,
    message: 'output.table() is only available in Airtable Scripting Extension — use output.set() to pass data to subsequent steps.',
  },
  {
    pattern: /\boutput\.clear\s*\(/g,
    message: 'output.clear() is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
  {
    pattern: /\boutput\.inspect\s*\(/g,
    message: 'output.inspect() is only available in Airtable Scripting Extension, not Automation Scripts.',
  },
];

// ---------------------------------------------------------------------------
// Wrong-context check (D-04: wrong-context only — no missing-await, no unknown-global)
// ---------------------------------------------------------------------------

function checkWrongContext(
    text: string,
    exclusionRanges: Array<{ start: number; end: number }>,
    newlines: number[]
): LsDiagnostic[] {
    const diagnostics: LsDiagnostic[] = [];

    for (const entry of FORBIDDEN_PATTERNS) {
        // REQUIRED: reset module-scope /g pattern before each scan.
        // Without this reset, the second call on any document skips matches
        // before the stale lastIndex position (RESEARCH.md Pitfall 1).
        entry.pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = entry.pattern.exec(text)) !== null) {
            if (isInsideExclusionRange(match.index, exclusionRanges)) continue;
            diagnostics.push({
                range: makeRange(text, newlines, match.index, match.index + match[0].length),
                message: entry.message,
                severity: LsSeverity.Warning,
                code: 'wrong-context',
                source: 'airtable-automation',
            });
        }
    }

    return diagnostics;
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

export function automationDiagnostics(text: string, _uri?: string): LsDiagnostic[] {
    const exclusionRanges = getExclusionRanges(text);
    const newlines = newlineOffsets(text);
    return [
        ...checkMissingAwait(text, exclusionRanges, newlines),
        ...checkUnknownGlobals(text, exclusionRanges, newlines),
        ...checkWrongContext(text, exclusionRanges, newlines),
    ];
}
