import type { LsDiagnostic, LsRange } from '../../types.js';
import { LsSeverity } from '../../types.js';

// ---------------------------------------------------------------------------
// Position helpers (verbatim from script/diagnostics.ts)
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

function isInsideExclusionRange(
  position: number,
  ranges: Array<{ start: number; end: number }>
): boolean {
  return ranges.some(range => position >= range.start && position < range.end);
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
    exclusionRanges: Array<{ start: number; end: number }>
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
                range: makeRange(text, match.index, match.index + match[0].length),
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
    return checkWrongContext(text, exclusionRanges);
}
