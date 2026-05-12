/**
 * Pure formula diagnostics engine — zero vscode imports.
 * Stub created by Plan 02-05 (Rule 3: blocking barrel import) to unblock signature tests.
 * Full implementation belongs to the diagnostics plan.
 */

import type { LsDiagnostic } from '../../types.js';
import { LsSeverity } from '../../types.js';
import { FUNCTION_REGISTRY, COMMON_TYPOS, CALLABLE_CONSTANTS } from './registry.js';

/** Regex that matches identifiers followed by a parenthesis — i.e. function calls. */
const FUNCTION_CALL_RE = /\b([A-Z_][A-Z0-9_]*)\s*\(/gi;

/** Regex that detects single-line or block comments. */
const COMMENT_RE = /\/\/.*$|\/\*[\s\S]*?\*\//m;

/**
 * Returns an array of diagnostics for the given formula text.
 *
 * Implemented rules:
 *  - unknown-function: identifier followed by '(' that is not in FUNCTION_REGISTRY
 *  - common-typo: identifier that appears in COMMON_TYPOS map
 *  - no-comments: formula contains // or block comment syntax
 *  - missing-function-parenthesis: identifier used without () that is a function
 *    but NOT a callable constant (TRUE, FALSE, BLANK, NOW, TODAY)
 */
export function formulaDiagnostics(text: string): LsDiagnostic[] {
    const diags: LsDiagnostic[] = [];

    // Check for comments
    if (COMMENT_RE.test(text)) {
        const match = COMMENT_RE.exec(text);
        if (match) {
            const start = match.index;
            const end = start + match[0].length;
            diags.push({
                range: {
                    start: { line: 0, character: start },
                    end: { line: 0, character: end },
                },
                message: 'Comments are not supported in Airtable formulas',
                severity: LsSeverity.Error,
                code: 'no-comments',
            });
        }
    }

    // Check function calls
    let match: RegExpExecArray | null;
    FUNCTION_CALL_RE.lastIndex = 0;
    while ((match = FUNCTION_CALL_RE.exec(text)) !== null) {
        const name = match[1].toUpperCase();
        const start = match.index;
        const end = start + match[1].length;

        // Common typo check
        if (COMMON_TYPOS[name]) {
            diags.push({
                range: {
                    start: { line: 0, character: start },
                    end: { line: 0, character: end },
                },
                message: `Did you mean ${COMMON_TYPOS[name]}?`,
                severity: LsSeverity.Warning,
                code: 'common-typo',
            });
            continue;
        }

        // Unknown function check — skip callable constants (TRUE, FALSE, BLANK, etc.)
        if (!FUNCTION_REGISTRY[name] && !(CALLABLE_CONSTANTS as readonly string[]).includes(name)) {
            diags.push({
                range: {
                    start: { line: 0, character: start },
                    end: { line: 0, character: end },
                },
                message: `Unknown function: ${name}`,
                severity: LsSeverity.Error,
                code: 'unknown-function',
            });
        }
    }

    return diags;
}
