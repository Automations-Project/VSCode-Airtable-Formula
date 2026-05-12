import type { LsSignatureHelp, LsPosition } from '../../types.js';
import { FUNCTION_REGISTRY } from './registry.js';

/**
 * Converts a line/character position to a character offset within a string.
 */
function positionToOffset(text: string, pos: { line: number; character: number }): number {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < pos.line && i < lines.length; i++) {
        offset += lines[i].length + 1;
    }
    return offset + pos.character;
}

/**
 * Find the function name and parameter index at the current cursor position.
 *
 * Known limitation (Pitfall 5): commas inside string literals are not handled —
 * e.g. IF("a,b", 1, 2) would report parameterIndex=2 at the second argument
 * instead of 1. This was a pre-existing limitation in the original VS Code provider.
 */
function findFunctionContext(
    textToCursor: string
): { functionName: string; parameterIndex: number } | null {

    let depth = 0;
    let parameterIndex = 0;
    let functionStart = -1;

    // Scan backwards from cursor to find the function we're in
    for (let i = textToCursor.length - 1; i >= 0; i--) {
        const char = textToCursor[i];

        if (char === ')') {
            depth++;
        } else if (char === '(') {
            if (depth === 0) {
                functionStart = i;
                break;
            }
            depth--;
        } else if (char === ',' && depth === 0) {
            parameterIndex++;
        }
    }

    if (functionStart === -1) {
        return null;
    }

    // Extract function name (word before the opening parenthesis)
    const beforeParen = textToCursor.substring(0, functionStart);
    const match = beforeParen.match(/([A-Z_][A-Z0-9_]*)\s*$/i);

    if (!match) {
        return null;
    }

    return {
        functionName: match[1],
        parameterIndex
    };
}

/**
 * Parse parameters from a function signature string.
 * e.g. 'IF(logical, value_if_true, value_if_false)' → [{name:'logical',...}, ...]
 */
function parseParameters(signature: string): Array<{ name: string; optional: boolean }> {
    const match = signature.match(/\(([^)]*)\)/);
    if (!match) {
        return [];
    }

    const paramsStr = match[1];
    if (!paramsStr.trim()) {
        return [];
    }

    return paramsStr.split(',').map(param => {
        const trimmed = param.trim();
        const optional = trimmed.startsWith('[') || trimmed.includes('...');
        const name = trimmed.replace(/[\[\]]/g, '').trim();
        return { name, optional };
    });
}

/**
 * Get description for a specific parameter of a known function.
 */
function getParameterDescription(functionName: string, paramName: string): string {
    const descriptions: Record<string, Record<string, string>> = {
        'IF': {
            'logical': 'The condition to evaluate (returns TRUE or FALSE)',
            'value_if_true': 'Value returned when condition is TRUE',
            'value_if_false': 'Value returned when condition is FALSE'
        },
        'SWITCH': {
            'expression': 'The value to match against patterns',
            'pattern1': 'First pattern to match',
            'result1': 'Result if first pattern matches',
            'default': 'Default value if no patterns match'
        },
        'DATEADD': {
            'date': 'The starting date',
            'count': 'Number of units to add (can be negative)',
            'units': 'Time unit: "days", "weeks", "months", "years", "hours", "minutes", "seconds"'
        },
        'DATETIME_DIFF': {
            'date1': 'The end date',
            'date2': 'The start date',
            'units': 'Time unit for the difference'
        },
        'DATETIME_FORMAT': {
            'date': 'The date to format',
            'format_specifier': 'Format string (e.g., "YYYY-MM-DD", "MM/DD/YYYY")'
        },
        'CONCATENATE': {
            'text1': 'First text string',
            'text2': 'Second text string'
        },
        'LEFT': {
            'string': 'The text to extract from',
            'howMany': 'Number of characters to extract'
        },
        'RIGHT': {
            'string': 'The text to extract from',
            'howMany': 'Number of characters to extract'
        },
        'MID': {
            'string': 'The text to extract from',
            'whereToStart': 'Starting position (1-based)',
            'count': 'Number of characters to extract'
        },
        'SUBSTITUTE': {
            'string': 'The original text',
            'old_text': 'Text to find and replace',
            'new_text': 'Replacement text',
            'index': 'Which occurrence to replace (optional, all if omitted)'
        },
        'REGEX_MATCH': {
            'text': 'The text to search in',
            'regex': 'Regular expression pattern'
        },
        'REGEX_EXTRACT': {
            'text': 'The text to extract from',
            'regex': 'Regular expression pattern with capture group'
        },
        'REGEX_REPLACE': {
            'text': 'The original text',
            'regex': 'Regular expression pattern',
            'replacement': 'Replacement text'
        }
    };

    const funcDescriptions = descriptions[functionName.toUpperCase()];
    if (funcDescriptions) {
        // Try exact match first
        if (funcDescriptions[paramName]) {
            return funcDescriptions[paramName];
        }
        // Try partial match for variadic params
        for (const [key, desc] of Object.entries(funcDescriptions)) {
            if (paramName.includes(key) || key.includes(paramName.replace(/\d+$/, ''))) {
                return desc;
            }
        }
    }

    return '';
}

/**
 * Pure signature-help engine for Airtable formula functions.
 * No vscode imports — uses LsSignatureHelp types from types.ts.
 *
 * Replaces AirtableFormulaSignatureHelpProvider.provideSignatureHelp.
 * The VS Code layer passed document.getText(new vscode.Range(start, position))
 * to get text up to the cursor; here we accept the full text and position and
 * compute the same substring via positionToOffset.
 */
export function formulaSignatureHelp(text: string, pos: LsPosition): LsSignatureHelp | null {
    const offset = positionToOffset(text, pos);
    const textToCursor = text.substring(0, offset);

    const funcContext = findFunctionContext(textToCursor);
    if (!funcContext) return null;

    const funcInfo = FUNCTION_REGISTRY[funcContext.functionName.toUpperCase()];
    if (!funcInfo) return null;

    const params = parseParameters(funcInfo.signature);
    const lastParam = params[params.length - 1];
    const activeParameter = (lastParam?.name.includes('...') && funcContext.parameterIndex >= params.length - 1)
        ? params.length - 1
        : Math.min(funcContext.parameterIndex, params.length - 1);

    return {
        signatures: [{
            label: funcInfo.signature,
            documentation: funcInfo.description,
            parameters: params.map(p => ({
                label: p.name,
                documentation: getParameterDescription(funcContext.functionName, p.name),
            })),
        }],
        activeSignature: 0,
        activeParameter,
    };
}
