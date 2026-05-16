/**
 * Pure formula diagnostics engine -- no 'vscode' imports.
 * Migrated from packages/extension/src/diagnostics.ts (713 lines).
 *
 * The uri parameter is optional. When provided, parenthesis/bracket
 * diagnostics emit relatedInformation pointing to the opening delimiter.
 */

import type { LsDiagnostic, LsRange } from '../../types.js';
import { LsSeverity } from '../../types.js';
import {
  ALL_FUNCTION_NAMES,
  ALL_CALLABLE,
  CALLABLE_CONSTANTS,
  SMART_QUOTES,
  COMMON_TYPOS,
  levenshteinDistance,
} from './registry.js';

// ---------------------------------------------------------------------------
// Position helpers (replace document.positionAt / new vscode.Range)
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
// Processes the formula left-to-right so that characters inside comments
// and field-ref bodies are consumed before the string scanners see them.
// This prevents a " inside 'regex_pattern' from opening a spurious
// double-quoted "string" that spans a newline and swallows the opening "
// of a real string on the next line (root cause of dl-in-"dl=1" false positive).
//
// Single and double-quoted strings stop at newlines: Airtable formula
// strings cannot span lines (use CHAR(10) for embedded newlines).
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

    // Field reference  { ... }  (no nesting)
    if (ch === '{') {
      let j = i + 1;
      while (j < len && text[j] !== '}') j++;
      if (j < len) j++;
      ranges.push({ start: i, end: j });
      i = j;
      continue;
    }

    // Double-quoted string  " ... "  (stops at newline)
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

    // Single-quoted string  ' ... '  (stops at newline)
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
// findClosestFunction helper
// ---------------------------------------------------------------------------

function findClosestFunction(input: string): string | null {
  const inputUpper = input.toUpperCase();
  let minDistance = Infinity;
  let closest: string | null = null;

  for (const func of ALL_CALLABLE) {
    const distance = levenshteinDistance(inputUpper, func);
    if (distance < minDistance && distance <= 3) {
      minDistance = distance;
      closest = func;
    }
  }

  return closest;
}

// ---------------------------------------------------------------------------
// Individual check functions (private class methods -> module-level functions)
// ---------------------------------------------------------------------------

function checkComments(text: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];

  const singleLineCommentRegex = /\/\/.*/g;
  let match: RegExpExecArray | null;

  while ((match = singleLineCommentRegex.exec(text)) !== null) {
    diagnostics.push({
      range: makeRange(text, match.index, match.index + match[0].length),
      message:
        'Comments are not allowed in Airtable formulas. This will cause an error when used in Airtable.',
      severity: LsSeverity.Warning,
      code: 'no-comments',
      source: 'airtable-formula',
    });
  }

  const blockCommentRegex = /\/\*[\s\S]*?\*\//g;

  while ((match = blockCommentRegex.exec(text)) !== null) {
    diagnostics.push({
      range: makeRange(text, match.index, match.index + match[0].length),
      message:
        'Comments are not allowed in Airtable formulas. This will cause an error when used in Airtable.',
      severity: LsSeverity.Warning,
      code: 'no-comments',
      source: 'airtable-formula',
    });
  }

  return diagnostics;
}

function checkParentheses(text: string, uri?: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const stack: Array<{ char: string; pos: number }> = [];
  let insideString = false;
  let stringChar = '';

  for (let i = 0; i < text.length; i++) {
    // Track string context to avoid false positives inside strings
    if (
      (text[i] === '"' || text[i] === "'") &&
      (i === 0 || text[i - 1] !== '\\')
    ) {
      if (!insideString) {
        insideString = true;
        stringChar = text[i];
      } else if (text[i] === stringChar) {
        insideString = false;
        stringChar = '';
      }
      continue;
    }

    if (insideString) continue;

    if (text[i] === '(') {
      stack.push({ char: '(', pos: i });
    } else if (text[i] === ')') {
      if (stack.length === 0 || stack[stack.length - 1].char !== '(') {
        diagnostics.push({
          range: makeRange(text, i, i + 1),
          message: 'Unmatched closing parenthesis',
          severity: LsSeverity.Error,
          source: 'airtable-formula',
        });
      } else {
        stack.pop();
      }
    }
  }

  // Report unclosed parentheses -- point to end of file
  for (const unclosed of stack) {
    if (unclosed.char === '(') {
      const openPos = offsetToPosition(text, unclosed.pos);
      const endOffset = Math.max(0, text.length - 1);

      const diag: LsDiagnostic = {
        range: makeRange(text, endOffset, text.length),
        message:
          `Missing closing parenthesis for '(' at line ${openPos.line + 1}, column ${openPos.character + 1}`,
        severity: LsSeverity.Error,
        source: 'airtable-formula',
      };

      if (uri) {
        diag.relatedInformation = [
          {
            location: {
              uri,
              range: makeRange(text, unclosed.pos, unclosed.pos + 1),
            },
            message: 'Opening parenthesis is here',
          },
        ];
      }

      diagnostics.push(diag);
    }
  }

  return diagnostics;
}

function checkBrackets(text: string, uri?: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const stack: Array<{ char: string; pos: number }> = [];
  let insideString = false;
  let stringChar = '';

  for (let i = 0; i < text.length; i++) {
    if (
      (text[i] === '"' || text[i] === "'") &&
      (i === 0 || text[i - 1] !== '\\')
    ) {
      if (!insideString) {
        insideString = true;
        stringChar = text[i];
      } else if (text[i] === stringChar) {
        insideString = false;
        stringChar = '';
      }
      continue;
    }

    if (!insideString) {
      if (text[i] === '{') {
        stack.push({ char: '{', pos: i });
      } else if (text[i] === '}') {
        if (stack.length === 0 || stack[stack.length - 1].char !== '{') {
          diagnostics.push({
            range: makeRange(text, i, i + 1),
            message: 'Unmatched closing bracket',
            severity: LsSeverity.Error,
            source: 'airtable-formula',
          });
        } else {
          stack.pop();
        }
      }
    }
  }

  // Report unclosed brackets -- point to end of file
  for (const unclosed of stack) {
    if (unclosed.char === '{') {
      const openPos = offsetToPosition(text, unclosed.pos);
      const endOffset = Math.max(0, text.length - 1);

      const diag: LsDiagnostic = {
        range: makeRange(text, endOffset, text.length),
        message:
          `Missing closing bracket for '{' at line ${openPos.line + 1}, column ${openPos.character + 1}`,
        severity: LsSeverity.Error,
        source: 'airtable-formula',
      };

      if (uri) {
        diag.relatedInformation = [
          {
            location: {
              uri,
              range: makeRange(text, unclosed.pos, unclosed.pos + 1),
            },
            message: 'Opening bracket is here',
          },
        ];
      }

      diagnostics.push(diag);
    }
  }

  return diagnostics;
}

function checkQuotes(text: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let singleQuoteStart = -1;
  let doubleQuoteStart = -1;

  for (let i = 0; i < text.length; i++) {
    // Skip escaped quotes
    if (i > 0 && text[i - 1] === '\\') continue;

    if (text[i] === '"') {
      if (!inSingleQuote) {
        if (!inDoubleQuote) {
          inDoubleQuote = true;
          doubleQuoteStart = i;
        } else {
          inDoubleQuote = false;
          doubleQuoteStart = -1;
        }
      }
    } else if (text[i] === "'") {
      if (!inDoubleQuote) {
        if (!inSingleQuote) {
          inSingleQuote = true;
          singleQuoteStart = i;
        } else {
          inSingleQuote = false;
          singleQuoteStart = -1;
        }
      }
    }
  }

  if (inDoubleQuote && doubleQuoteStart !== -1) {
    diagnostics.push({
      range: makeRange(text, doubleQuoteStart, doubleQuoteStart + 1),
      message: 'Unclosed double quote',
      severity: LsSeverity.Error,
      source: 'airtable-formula',
    });
  }

  if (inSingleQuote && singleQuoteStart !== -1) {
    diagnostics.push({
      range: makeRange(text, singleQuoteStart, singleQuoteStart + 1),
      message: 'Unclosed single quote',
      severity: LsSeverity.Error,
      source: 'airtable-formula',
    });
  }

  return diagnostics;
}

function checkFunctions(text: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const exclusionRanges = getExclusionRanges(text);

  // Build functions-requiring-parens set: ALL_FUNCTION_NAMES minus CALLABLE_CONSTANTS.
  // Pitfall 3: TRUE and FALSE are in CALLABLE_CONSTANTS (5 entries) -- exclude them so
  // IF({Field}, TRUE, FALSE) never triggers 'missing-function-parenthesis'.
  const callableConstantsSet = new Set<string>(CALLABLE_CONSTANTS);
  const functionsRequiringParens = ALL_FUNCTION_NAMES.filter(
    name => !callableConstantsSet.has(name)
  );

  // Check for functions without opening parenthesis
  const functionWithoutParenPattern = new RegExp(
    `\\b(${functionsRequiringParens.join('|')})\\b(?!\\s*\\()`,
    'g'
  );
  let match: RegExpExecArray | null;

  while ((match = functionWithoutParenPattern.exec(text)) !== null) {
    const functionName = match[1];

    if (isInsideExclusionRange(match.index, exclusionRanges)) continue;

    diagnostics.push({
      range: makeRange(text, match.index, match.index + functionName.length),
      message: `Function '${functionName}' is missing its opening parenthesis. Should be '${functionName}('`,
      severity: LsSeverity.Error,
      code: 'missing-function-parenthesis',
      source: 'airtable-formula',
    });
  }

  // Check for unknown functions (identifiers followed by '(')
  const functionPattern = /\b([A-Z_][A-Z0-9_]*)\s*\(/g;

  while ((match = functionPattern.exec(text)) !== null) {
    const functionName = match[1];

    if (isInsideExclusionRange(match.index, exclusionRanges)) continue;

    if (!ALL_CALLABLE.includes(functionName)) {
      const suggestion = findClosestFunction(functionName);
      const message = suggestion
        ? `Unknown function '${functionName}'. Did you mean '${suggestion}'?`
        : `Unknown function '${functionName}'`;

      diagnostics.push({
        range: makeRange(text, match.index, match.index + functionName.length),
        message,
        severity: LsSeverity.Error,
        code: 'unknown-function',
        source: 'airtable-formula',
      });
    }
  }

  return diagnostics;
}

function checkSmartQuotes(text: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];

  for (const [smartQuote, replacement] of Object.entries(SMART_QUOTES)) {
    let index = text.indexOf(smartQuote);
    while (index !== -1) {
      diagnostics.push({
        range: makeRange(text, index, index + 1),
        message: `Smart quote detected. Replace with straight quote: ${replacement}`,
        severity: LsSeverity.Error,
        code: 'smart-quote',
        source: 'airtable-formula',
      });
      index = text.indexOf(smartQuote, index + 1);
    }
  }

  return diagnostics;
}

function checkCommonTypos(text: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const exclusionRanges = getExclusionRanges(text);

  for (const [typo, suggestion] of Object.entries(COMMON_TYPOS)) {
    const pattern = new RegExp(`\\b${typo}\\s*\\(`, 'gi');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      if (isInsideExclusionRange(match.index, exclusionRanges)) continue;

      diagnostics.push({
        range: makeRange(text, match.index, match.index + typo.length),
        message: `'${typo}' is not an Airtable function. Use ${suggestion}`,
        severity: LsSeverity.Error,
        code: 'common-typo',
        source: 'airtable-formula',
      });
    }
  }

  return diagnostics;
}

function checkDivisionByZero(text: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const exclusionRanges = getExclusionRanges(text);

  // Pattern: field or number divided by a field reference (potential zero)
  const divisionPattern = /(\{[^}]+\}|\d+(?:\.\d+)?)\s*\/\s*(\{[^}]+\})/g;
  let match: RegExpExecArray | null;

  while ((match = divisionPattern.exec(text)) !== null) {
    if (isInsideExclusionRange(match.index, exclusionRanges)) continue;

    // Look backwards for an IF( guard that checks for zero
    const lookback = Math.max(0, match.index - 100);
    const context = text.slice(lookback, match.index);
    const hasGuard = /IF\s*\([^)]*(?:=\s*0|!=\s*0|ISERROR)/i.test(context);

    if (!hasGuard) {
      const divisor = match[2];
      diagnostics.push({
        range: makeRange(text, match.index, match.index + match[0].length),
        message: `Potential division by zero. Consider: IF(${divisor}=0, BLANK(), ${match[0]})`,
        severity: LsSeverity.Warning,
        code: 'division-by-zero',
        source: 'airtable-formula',
      });
    }
  }

  return diagnostics;
}

/**
 * Returns true when the IF chain is a dispatch table — every IF tests the same
 * field/expression against a different literal value, e.g.:
 *   IF({Game}='Fortnite', …, IF({Game}='Apex', …, IF({Game}='Valorant', …)))
 *
 * This is the idiomatic way to branch on a single field in Airtable when
 * SWITCH() would exceed its case limit (~15–25 cases). The nesting is
 * intentional and not a readability problem, so nested-if is suppressed.
 *
 * Detection: collect the first argument (condition) of every IF call, extract
 * the left-hand side of the comparison, and check whether a single LHS
 * dominates (≥ 60%). The 60% threshold tolerates a handful of sub-IFs inside
 * then-branches that test unrelated conditions.
 */
function isDispatchTablePattern(text: string): boolean {
  const conditions: string[] = [];

  for (let i = 0; i < text.length - 2; i++) {
    const upper = text.slice(i, i + 4).toUpperCase();
    let condStart = -1;
    if (upper.startsWith('IF(')) condStart = i + 3;
    else if (upper === 'IF (') condStart = i + 4;
    if (condStart < 0) continue;

    let depth = 0;
    let inStr = false;
    let strChar = '';
    for (let j = condStart; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (ch === strChar) inStr = false;
      } else if (ch === '"' || ch === "'") {
        inStr = true;
        strChar = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        if (depth === 0) break;
        depth--;
      } else if (ch === ',' && depth === 0) {
        conditions.push(text.slice(condStart, j).trim());
        break;
      }
    }
  }

  if (conditions.length < 4) return false;

  const lhsList = conditions
    .map(c => {
      const m = c.match(/^(.*?)(?:\s*(?:!=|<=|>=|=|<|>))/);
      return m ? m[1].trim() : '';
    })
    .filter(Boolean);

  if (lhsList.length < 3) return false;

  const counts = new Map<string, number>();
  for (const lhs of lhsList) counts.set(lhs, (counts.get(lhs) ?? 0) + 1);

  const maxCount = Math.max(0, ...counts.values());
  return maxCount / lhsList.length >= 0.6;
}

function checkNestedIfs(text: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];

  let maxDepth = 0;
  let currentDepth = 0;
  let deepestStart = 0;

  for (let i = 0; i < text.length; i++) {
    const slice = text.slice(i, i + 4).toUpperCase();
    if (slice.startsWith('IF(') || slice.startsWith('IF (')) {
      currentDepth++;
      if (currentDepth > maxDepth) {
        maxDepth = currentDepth;
        deepestStart = i;
      }
    } else if (text[i] === ')') {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  if (maxDepth >= 4 && !isDispatchTablePattern(text)) {
    diagnostics.push({
      range: makeRange(text, deepestStart, Math.min(deepestStart + 20, text.length)),
      message: `Deeply nested IF (${maxDepth} levels). Consider using SWITCH() for better readability.`,
      severity: LsSeverity.Information,
      code: 'nested-if',
      source: 'airtable-formula',
    });
  }

  return diagnostics;
}

function checkTrailingOperators(text: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];

  const trimmed = text.trim();
  const trailingOpMatch = trimmed.match(/[+\-*/&,]\s*$/);

  if (trailingOpMatch) {
    const index = text.lastIndexOf(trailingOpMatch[0].trim());
    diagnostics.push({
      range: makeRange(text, index, index + 1),
      message: 'Trailing operator - expression appears incomplete',
      severity: LsSeverity.Error,
      code: 'trailing-operator',
      source: 'airtable-formula',
    });
  }

  return diagnostics;
}

function checkUnknownTokens(text: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  const exclusionRanges = getExclusionRanges(text);
  const knownUpper = new Set(ALL_CALLABLE.map(n => n.toUpperCase()));

  for (const m of text.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g)) {
    if (isInsideExclusionRange(m.index!, exclusionRanges)) continue;

    const ident = m[1];
    const afterIdent = m.index! + ident.length;

    // Skip purely-uppercase identifiers — checkFunctions already handles them
    if (ident === ident.toUpperCase()) continue;

    // Skip known callables regardless of case (TRUE/true, IF/if, etc.)
    if (knownUpper.has(ident.toUpperCase())) continue;

    const isCall = /^\s*\(/.test(text.slice(afterIdent));

    if (isCall) {
      // Lowercase function call — always invalid; Airtable functions must be UPPERCASE
      const suggestion = findClosestFunction(ident);
      const message = suggestion
        ? `Unknown function '${ident}'. Airtable functions are UPPERCASE — did you mean '${suggestion}'?`
        : `Unknown function '${ident}'. Airtable function names must be UPPERCASE.`;
      diagnostics.push({
        range: makeRange(text, m.index!, afterIdent),
        message,
        severity: LsSeverity.Error,
        code: 'unknown-token',
        source: 'airtable-formula',
      });
      continue;
    }

    // For non-call bare identifiers: Airtable allows bare field names without {}
    // (e.g. FUNC(fieldName, ...) is valid). Only flag when the identifier is
    // directly adjacent to another expression token with no operator/separator
    // between them — that indicates invalid syntax, not a field reference.
    //
    // Flagged:     testbug {field}  — next='{'
    //              "str"testbug     — prev='"'
    //              {field}testbug   — prev='}'
    //              )testbug         — prev=')'
    // Not flagged: FUNC(fieldName, ...) — prev='(', next=','
    let prevIdx = m.index! - 1;
    while (prevIdx >= 0 && (text[prevIdx] === ' ' || text[prevIdx] === '\t')) prevIdx--;
    const prevChar = prevIdx >= 0 ? text[prevIdx] : '';

    let nextIdx = afterIdent;
    while (nextIdx < text.length && (text[nextIdx] === ' ' || text[nextIdx] === '\t')) nextIdx++;
    const nextChar = nextIdx < text.length ? text[nextIdx] : '';

    const suspiciousPrev = prevChar === '"' || prevChar === "'" || prevChar === '}' || prevChar === ')';
    const suspiciousNext = nextChar === '"' || nextChar === "'" || nextChar === '{';

    if (!suspiciousPrev && !suspiciousNext) continue;

    diagnostics.push({
      range: makeRange(text, m.index!, afterIdent),
      message: `'${ident}' is not a valid formula token. Use a field reference {${ident}} or a string literal "${ident}".`,
      severity: LsSeverity.Error,
      code: 'unknown-token',
      source: 'airtable-formula',
    });
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run all formula diagnostic checks on the given text.
 *
 * @param text - The raw formula text to analyse.
 * @param uri  - Optional document URI string. When provided, parenthesis/bracket
 *               diagnostics include relatedInformation pointing to the opening
 *               delimiter. Pass document.uri.toString() from the VS Code wrapper.
 */
export function formulaDiagnostics(text: string, uri?: string): LsDiagnostic[] {
  const diagnostics: LsDiagnostic[] = [];
  diagnostics.push(...checkComments(text));
  diagnostics.push(...checkParentheses(text, uri));
  diagnostics.push(...checkBrackets(text, uri));
  diagnostics.push(...checkQuotes(text));
  diagnostics.push(...checkFunctions(text));
  // checkFieldReferences intentionally disabled -- {} valid in JSON formula output
  diagnostics.push(...checkSmartQuotes(text));
  diagnostics.push(...checkCommonTypos(text));
  diagnostics.push(...checkDivisionByZero(text));
  diagnostics.push(...checkNestedIfs(text));
  diagnostics.push(...checkTrailingOperators(text));
  diagnostics.push(...checkUnknownTokens(text));
  return diagnostics;
}
