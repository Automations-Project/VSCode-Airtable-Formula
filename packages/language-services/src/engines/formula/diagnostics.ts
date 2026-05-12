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
// Exclusion ranges helper
// ---------------------------------------------------------------------------

/**
 * Get character-offset ranges to exclude from function validation.
 * Covers: field references {}, strings "", '', and comments.
 * Pitfall 2: offsets are into the raw string -- do NOT split by line first.
 */
function getExclusionRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  // Field references: {...}
  const fieldRefRegex = /\{[^{}]*\}/g;
  let match: RegExpExecArray | null;
  while ((match = fieldRefRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Double-quoted strings: "..."
  const doubleQuoteRegex = /"(?:[^"\\]|\\.)*"/g;
  while ((match = doubleQuoteRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Single-quoted strings: '...'
  const singleQuoteRegex = /'(?:[^'\\]|\\.)*'/g;
  while ((match = singleQuoteRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Single-line comments: //...
  const singleLineCommentRegex = /\/\/.*/g;
  while ((match = singleLineCommentRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Block comments: /*...*/
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

  if (maxDepth >= 4) {
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
  return diagnostics;
}
