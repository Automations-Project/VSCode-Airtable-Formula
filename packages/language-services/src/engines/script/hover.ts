/**
 * Pure script hover engine — zero vscode imports.
 * Two-level resolution: method hover first, global hover second.
 * Adapted from formula hover analog — extractWordAt regex changed from
 * /[A-Z_][A-Z0-9_]*\/ to /[a-zA-Z_$][a-zA-Z0-9_$]*\/ (JS identifiers; no toUpperCase).
 */

import type { LsHover, LsRange, LsPosition } from '../../types.js';
import { SCRIPT_GLOBALS } from './registry.js';

// ---------------------------------------------------------------------------
// Helpers (adapted from packages/language-services/src/engines/formula/hover.ts)
// ---------------------------------------------------------------------------

/**
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
 * Returns the word token containing the given offset, or null.
 * JS identifier regex: /[a-zA-Z_$][a-zA-Z0-9_$]*/g (case-sensitive; no toUpperCase).
 */
function extractWordAt(
    text: string,
    offset: number,
): { word: string; start: number; end: number } | null {
    const wordRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
    let match: RegExpExecArray | null;
    while ((match = wordRegex.exec(text)) !== null) {
        if (match.index <= offset && offset <= match.index + match[0].length) {
            return { word: match[0], start: match.index, end: match.index + match[0].length };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns hover information for the word at the given position in a script string.
 *
 * Resolution order:
 * 1. Level 2 (method hover): search a fixed 80-char window (offset +/- 40) for
 *    globalName.methodName patterns. If cursor falls within the method name and both
 *    globalName and methodName are in SCRIPT_GLOBALS, return method signature + description.
 *    Window is bounded to text length — O(1) execution (T-03-01).
 * 2. Level 1 (global hover): extract word under cursor. If it is a SCRIPT_GLOBALS key,
 *    return global description hover with range.
 * 3. Returns null if neither level matched.
 */
export function scriptHover(text: string, pos: LsPosition): LsHover | null {
    if (!text) return null;

    const offset = positionToOffset(text, pos);

    // Level 2: method hover — search an 80-char window around cursor for globalName.methodName
    const windowStart = Math.max(0, offset - 40);
    const windowEnd = Math.min(text.length, offset + 40);
    const textWindow = text.slice(windowStart, windowEnd);

    // dotPattern uses two simple char-class repetitions, no nested quantifiers (T-03-01)
    const dotPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let dotResult: RegExpExecArray | null;
    while ((dotResult = dotPattern.exec(textWindow)) !== null) {
        const globalName = dotResult[1];
        const methodName = dotResult[2];
        // Compute absolute start of method name in original text: windowStart + match start + globalName length + 1 (dot)
        const methodAbsStart = windowStart + dotResult.index + dotResult[1].length + 1;
        const methodAbsEnd = methodAbsStart + dotResult[2].length;
        // Cursor must fall within the method name span
        if (offset >= methodAbsStart && offset <= methodAbsEnd) {
            const globalInfo = SCRIPT_GLOBALS[globalName];
            if (globalInfo?.methods[methodName]) {
                const method = globalInfo.methods[methodName];
                return {
                    contents: { kind: 'markdown', value: `**${method.signature}**\n\n${method.description}` },
                };
            }
        }
    }

    // Level 1: global-level hover — word under cursor
    const wordMatch = extractWordAt(text, offset);
    if (!wordMatch) return null;

    const { word, start, end } = wordMatch;
    const range: LsRange = {
        start: offsetToPosition(text, start),
        end: offsetToPosition(text, end),
    };

    const globalInfo = SCRIPT_GLOBALS[word];
    if (globalInfo) {
        return {
            contents: { kind: 'markdown', value: `**${word}**\n\n${globalInfo.description}` },
            range,
        };
    }

    return null;
}
