/**
 * Pure automation completions engine — zero vscode imports.
 * Derives all completion items from AUTOMATION_GLOBALS (no new data).
 * Two levels: top-level Variable-kind globals and dot-triggered Method-kind items.
 */

import type { LsCompletionItem, LsPosition } from '../../types.js';
import { LsCompletionItemKind } from '../../types.js';
import { AUTOMATION_GLOBALS, AUTOMATION_GLOBAL_NAMES } from './registry.js';

function positionToOffset(text: string, pos: { line: number; character: number }): number {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < pos.line && i < lines.length; i++) {
        offset += lines[i].length + 1; // +1 for the \n
    }
    return offset + pos.character;
}

/**
 * Returns completion items for Airtable Automation Script language.
 *
 * Level 2 (dot-triggered): when text before cursor ends with `globalName.`,
 * returns Method-kind items for all methods on that global.
 * If the global exists but has no methods (e.g. fetch), returns [].
 * If the global is unknown, returns [] (this engine has no completions for it).
 *
 * Level 1 (top-level): returns Variable-kind items for all 5 automation globals.
 *
 * Note: fetch has an empty methods object. Typing 'fetch.' returns []
 * (correct — VS Code built-in JS server handles Response chain methods).
 */
export function automationCompletions(text: string, pos: LsPosition): LsCompletionItem[] {
    const offset = positionToOffset(text, pos);
    const textToCursor = text.slice(0, offset);

    // Level 2: dot-triggered method completions
    const dotMatch = textToCursor.match(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\.\s*$/);
    if (dotMatch) {
        const globalName = dotMatch[1];
        const globalInfo = AUTOMATION_GLOBALS[globalName];
        if (globalInfo) {
            return Object.entries(globalInfo.methods).map(([name, method]) => ({
                label: name,
                kind: LsCompletionItemKind.Method,
                detail: globalName,
                documentation: { kind: 'markdown' as const, value: `**${method.signature}**\n\n${method.description}` },
                insertText: `${name}($0)`,
            }));
        }
        return [];
    }

    // Level 1: top-level global names (Variable kind)
    return AUTOMATION_GLOBAL_NAMES.map(name => ({
        label: name,
        kind: LsCompletionItemKind.Variable,
        documentation: { kind: 'markdown' as const, value: AUTOMATION_GLOBALS[name].description },
        insertText: name,
    }));
}
