/**
 * Pure automation hover engine — zero vscode imports.
 * Two-level resolution: method hover first, global hover second.
 * Adapted from script hover analog — registry changed to AUTOMATION_GLOBALS.
 */

import type { LsHover, LsRange, LsPosition } from '../../types.js';
import { AUTOMATION_GLOBALS } from './registry.js';

function positionToOffset(text: string, pos: { line: number; character: number }): number {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < pos.line && i < lines.length; i++) {
        offset += lines[i].length + 1;
    }
    return offset + pos.character;
}

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

/**
 * Returns hover information for the word at the given position in an automation script string.
 *
 * Resolution order:
 * 1. Level 2 (method hover): search a fixed 80-char window (offset +/- 40) for
 *    globalName.methodName patterns. O(1) execution (T-03-01).
 * 2. Level 1 (global hover): extract word under cursor; check AUTOMATION_GLOBALS.
 * 3. Returns null if neither level matched.
 */
export function automationHover(text: string, pos: LsPosition): LsHover | null {
    if (!text) return null;

    const offset = positionToOffset(text, pos);

    const windowStart = Math.max(0, offset - 40);
    const windowEnd = Math.min(text.length, offset + 40);
    const textWindow = text.slice(windowStart, windowEnd);

    const dotPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let dotResult: RegExpExecArray | null;
    while ((dotResult = dotPattern.exec(textWindow)) !== null) {
        const globalName = dotResult[1];
        const methodName = dotResult[2];
        const methodAbsStart = windowStart + dotResult.index + dotResult[1].length + 1;
        const methodAbsEnd = methodAbsStart + dotResult[2].length;
        if (offset >= methodAbsStart && offset <= methodAbsEnd) {
            const globalInfo = AUTOMATION_GLOBALS[globalName];
            if (globalInfo?.methods[methodName]) {
                const method = globalInfo.methods[methodName];
                return {
                    contents: { kind: 'markdown', value: `**${method.signature}**\n\n${method.description}` },
                };
            }
        }
    }

    const wordMatch = extractWordAt(text, offset);
    if (!wordMatch) return null;

    const { word, start, end } = wordMatch;
    const range: LsRange = {
        start: offsetToPosition(text, start),
        end: offsetToPosition(text, end),
    };

    const globalInfo = AUTOMATION_GLOBALS[word];
    if (globalInfo) {
        return {
            contents: { kind: 'markdown', value: `**${word}**\n\n${globalInfo.description}` },
            range,
        };
    }

    return null;
}
