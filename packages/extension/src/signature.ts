import * as vscode from 'vscode';
import { FUNCTION_REGISTRY } from './functions';

/**
 * Provides signature help (parameter hints) for Airtable formula functions
 */
export class AirtableFormulaSignatureHelpProvider implements vscode.SignatureHelpProvider {
    
    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.SignatureHelpContext
    ): vscode.SignatureHelp | null {
        
        // Find the function context at current position
        const funcContext = this.findFunctionContext(document, position);
        if (!funcContext) {
            return null;
        }
        
        const { functionName, parameterIndex } = funcContext;
        const funcInfo = FUNCTION_REGISTRY[functionName.toUpperCase()];
        
        if (!funcInfo) {
            return null;
        }
        
        // Parse parameters from signature
        const params = this.parseParameters(funcInfo.signature);
        
        // Create signature help
        const signatureHelp = new vscode.SignatureHelp();
        
        const signature = new vscode.SignatureInformation(
            funcInfo.signature,
            new vscode.MarkdownString(funcInfo.description)
        );
        
        // Add parameter information
        signature.parameters = params.map(param => {
            const paramInfo = new vscode.ParameterInformation(
                param.name,
                this.getParameterDescription(functionName, param.name)
            );
            return paramInfo;
        });
        
        signatureHelp.signatures = [signature];
        signatureHelp.activeSignature = 0;
        signatureHelp.activeParameter = Math.min(parameterIndex, params.length - 1);
        
        // Handle variadic functions (those with ...)
        if (params.length > 0 && params[params.length - 1].name.includes('...')) {
            if (parameterIndex >= params.length - 1) {
                signatureHelp.activeParameter = params.length - 1;
            }
        }
        
        return signatureHelp;
    }
    
    /**
     * Find the function name and parameter index at the current cursor position
     */
    private findFunctionContext(
        document: vscode.TextDocument,
        position: vscode.Position
    ): { functionName: string; parameterIndex: number } | null {
        
        const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        
        let depth = 0;
        let parameterIndex = 0;
        let functionStart = -1;
        
        // Scan backwards from cursor to find the function we're in
        for (let i = text.length - 1; i >= 0; i--) {
            const char = text[i];
            
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
        const beforeParen = text.substring(0, functionStart);
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
     * Parse parameters from a function signature string
     */
    private parseParameters(signature: string): Array<{ name: string; optional: boolean }> {
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
     * Get description for a specific parameter
     */
    private getParameterDescription(functionName: string, paramName: string): string {
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
}
