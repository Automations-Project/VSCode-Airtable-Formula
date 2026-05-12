/**
 * Pure formula hover engine — zero vscode imports.
 * Replaces vscode.HoverProvider with a plain function operating on strings.
 */

import type { LsHover, LsRange, LsPosition } from '../../types.js';
import { FUNCTION_REGISTRY, CALLABLE_CONSTANTS, type FunctionInfo } from './registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pure string equivalent of vscode Position.offsetAt / positionAt.
 * Converts a {line, character} position to a linear byte offset in text.
 */
function positionToOffset(text: string, pos: { line: number; character: number }): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for the \n
  }
  return offset + pos.character;
}

/**
 * Converts a linear byte offset back to a {line, character} position.
 */
function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  return { line, character: offset - lastNewline - 1 };
}

/**
 * Pure string equivalent of document.getWordRangeAtPosition with /[A-Z_][A-Z0-9_]*\/i.
 * Returns the word token that contains the given offset, or null.
 */
function extractWordAt(
  text: string,
  offset: number,
): { word: string; start: number; end: number } | null {
  const wordRegex = /[A-Z_][A-Z0-9_]*/gi;
  let match: RegExpExecArray | null;
  while ((match = wordRegex.exec(text)) !== null) {
    if (match.index <= offset && offset <= match.index + match[0].length) {
      return { word: match[0].toUpperCase(), start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

/**
 * Returns a category emoji — migrated verbatim from hover.ts lines 68-80.
 */
function getCategoryEmoji(category: string): string {
  const emojis: Record<string, string> = {
    'Text': '📝',
    'Numeric': '🔢',
    'Date/Time': '📅',
    'Logical': '🔀',
    'Array': '📋',
    'Regex': '🔍',
    'Record': '📄',
    'Misc': '🔧',
  };
  return emojis[category] || '📦';
}

/**
 * Builds a markdown hover for a known registry function.
 * Replaces vscode.MarkdownString with plain string concatenation (no VS Code API).
 */
function createFunctionHover(_name: string, info: FunctionInfo, range: LsRange): LsHover {
  const value = [
    '```airtable-formula',
    info.signature,
    '```',
    '',
    info.description,
    '',
    `${getCategoryEmoji(info.category)} **${info.category}**`,
  ].join('\n');
  return { contents: { kind: 'markdown', value }, range };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns hover information for the word at the given position in a formula string.
 *
 * Resolution order:
 * 1. FUNCTION_REGISTRY — includes TRUE/FALSE (gap fix D-05)
 * 2. CALLABLE_CONSTANTS that are NOT in the registry (NOW, TODAY, BLANK) -> generic constant hover
 * 3. Everything else -> null
 */
export function formulaHover(text: string, pos: LsPosition): LsHover | null {
  const offset = positionToOffset(text, pos);
  const wordMatch = extractWordAt(text, offset);
  if (!wordMatch) return null;

  const { word, start, end } = wordMatch;
  const range: LsRange = {
    start: offsetToPosition(text, start),
    end: offsetToPosition(text, end),
  };

  // Check FUNCTION_REGISTRY first -- TRUE/FALSE are registered here (D-05 gap fix)
  const funcInfo = FUNCTION_REGISTRY[word];
  if (funcInfo) {
    return createFunctionHover(word, funcInfo, range);
  }

  // Check CALLABLE_CONSTANTS not in registry (NOW, TODAY, BLANK)
  if ((CALLABLE_CONSTANTS as readonly string[]).includes(word)) {
    return {
      contents: { kind: 'markdown', value: `**${word}**\n\nAirtable built-in constant.` },
      range,
    };
  }

  return null;
}
