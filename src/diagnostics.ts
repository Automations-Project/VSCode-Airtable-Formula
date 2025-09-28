import * as vscode from 'vscode';

// List of valid Airtable functions organized by category
const AIRTABLE_FUNCTIONS = {
    text: [
        'CONCATENATE', 'LEFT', 'RIGHT', 'MID', 'LEN', 'FIND', 'SEARCH', 
        'SUBSTITUTE', 'REPLACE', 'TRIM', 'UPPER', 'LOWER', 'VALUE', 'T', 
        'REPT', 'TEXT'
    ],
    numeric: [
        'ABS', 'AVERAGE', 'CEILING', 'COUNT', 'COUNTA', 'COUNTALL', 'EXP', 
        'FLOOR', 'INT', 'LOG', 'LOG10', 'MAX', 'MIN', 'MOD', 'POWER', 
        'ROUND', 'ROUNDDOWN', 'ROUNDUP', 'SQRT', 'SUM'
    ],
    datetime: [
        'DATEADD', 'DATEDIF', 'DATETIME_DIFF', 'DATETIME_FORMAT', 'DATETIME_PARSE',
        'DATESTR', 'DAY', 'HOUR', 'MINUTE', 'MONTH', 'SECOND', 'SET_LOCALE',
        'SET_TIMEZONE', 'TIMESTR', 'TONOW', 'FROMNOW', 'WEEKDAY', 'WEEKNUM',
        'WORKDAY', 'WORKDAY_DIFF', 'YEAR'
    ],
    logical: [
        'AND', 'OR', 'NOT', 'XOR', 'IF', 'SWITCH', 'IS_SAME', 
        'IS_AFTER', 'IS_BEFORE', 'ISERROR', 'ERROR'
    ],
    array: [
        'ARRAYCOMPACT', 'ARRAYJOIN', 'ARRAYUNIQUE', 'ARRAYFLATTEN', 'ARRAYSLICE'
    ],
    regex: [
        'REGEX_MATCH', 'REGEX_EXTRACT', 'REGEX_REPLACE'
    ],
    record: [
        'RECORD_ID', 'AUTONUMBER', 'CREATED_BY', 'CREATED_TIME', 'LAST_MODIFIED_TIME', 'LAST_MODIFIED_BY'
    ],
    misc: [
        'ENCODE_URL_COMPONENT', 'BLANK'
    ]
};

// Flatten all functions into a single array for easy lookup
const ALL_FUNCTIONS = Object.values(AIRTABLE_FUNCTIONS).flat();

// Constants that don't require parentheses
const CONSTANTS = ['TRUE', 'FALSE', 'NOW', 'TODAY', 'BLANK'];

export class AirtableFormulaDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-formula');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-formula') {
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        
        // Check for common syntax issues
        diagnostics.push(...this.checkComments(document, text));
        diagnostics.push(...this.checkParentheses(document, text));
        diagnostics.push(...this.checkBrackets(document, text));
        diagnostics.push(...this.checkQuotes(document, text));
        diagnostics.push(...this.checkFunctions(document, text));
        diagnostics.push(...this.checkFieldReferences(document, text));

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private checkComments(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        
        // Check for single-line comments
        const singleLineCommentRegex = /\/\/.*/g;
        let match;
        
        while ((match = singleLineCommentRegex.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);
            
            const diagnostic = new vscode.Diagnostic(
                range,
                'Comments are not allowed in Airtable formulas. This will cause an error when used in Airtable.',
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.code = 'no-comments';
            diagnostics.push(diagnostic);
        }
        
        // Check for block comments
        const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
        
        while ((match = blockCommentRegex.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);
            
            const diagnostic = new vscode.Diagnostic(
                range,
                'Comments are not allowed in Airtable formulas. This will cause an error when used in Airtable.',
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.code = 'no-comments';
            diagnostics.push(diagnostic);
        }
        
        return diagnostics;
    }

    private checkParentheses(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const stack: Array<{char: string, pos: number}> = [];
        let insideString = false;
        let stringChar = '';
        
        for (let i = 0; i < text.length; i++) {
            // Track string context to avoid false positives
            if ((text[i] === '"' || text[i] === "'") && (i === 0 || text[i - 1] !== '\\')) {
                if (!insideString) {
                    insideString = true;
                    stringChar = text[i];
                } else if (text[i] === stringChar) {
                    insideString = false;
                    stringChar = '';
                }
                continue;
            }
            
            // Skip if we're inside a string
            if (insideString) {
                continue;
            }
            
            if (text[i] === '(') {
                stack.push({char: '(', pos: i});
            } else if (text[i] === ')') {
                if (stack.length === 0 || stack[stack.length - 1].char !== '(') {
                    // Unmatched closing parenthesis
                    const pos = document.positionAt(i);
                    const range = new vscode.Range(pos, pos.translate(0, 1));
                    diagnostics.push(new vscode.Diagnostic(
                        range,
                        'Unmatched closing parenthesis',
                        vscode.DiagnosticSeverity.Error
                    ));
                } else {
                    stack.pop();
                }
            }
        }
        
        // Report unclosed parentheses - point to where closing should be
        if (stack.length > 0) {
            for (const unclosed of stack) {
                if (unclosed.char === '(') {
                    const openPos = document.positionAt(unclosed.pos);
                    const endOfFile = document.positionAt(text.length);
                    
                    // Create a diagnostic at the end of the file where the closing ) is missing
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(endOfFile.translate(0, -1), endOfFile),
                        `Missing closing parenthesis for '(' at line ${openPos.line + 1}, column ${openPos.character + 1}`,
                        vscode.DiagnosticSeverity.Error
                    );
                    
                    // Add related information pointing to the opening parenthesis
                    diagnostic.relatedInformation = [
                        new vscode.DiagnosticRelatedInformation(
                            new vscode.Location(document.uri, new vscode.Range(openPos, openPos.translate(0, 1))),
                            'Opening parenthesis is here'
                        )
                    ];
                    
                    diagnostics.push(diagnostic);
                }
            }
        }
        
        return diagnostics;
    }

    private checkBrackets(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const stack: Array<{char: string, pos: number}> = [];
        let insideString = false;
        let stringChar = '';

        for (let i = 0; i < text.length; i++) {
            // Track string context
            if ((text[i] === '"' || text[i] === "'") && (i === 0 || text[i - 1] !== '\\')) {
                if (!insideString) {
                    insideString = true;
                    stringChar = text[i];
                } else if (text[i] === stringChar) {
                    insideString = false;
                    stringChar = '';
                }
                continue;
            }

            // Only check brackets outside of strings
            if (!insideString) {
                if (text[i] === '{') {
                    stack.push({char: '{', pos: i});
                } else if (text[i] === '}') {
                    if (stack.length === 0 || stack[stack.length - 1].char !== '{') {
                        // Unmatched closing bracket
                        const pos = document.positionAt(i);
                        const range = new vscode.Range(pos, pos.translate(0, 1));
                        diagnostics.push(new vscode.Diagnostic(
                            range,
                            'Unmatched closing bracket',
                            vscode.DiagnosticSeverity.Error
                        ));
                    } else {
                        stack.pop();
                    }
                }
            }
        }

        // Report unclosed brackets - point to where closing should be
        if (stack.length > 0) {
            for (const unclosed of stack) {
                if (unclosed.char === '{') {
                    const openPos = document.positionAt(unclosed.pos);
                    const endOfFile = document.positionAt(text.length);
                    
                    // Create a diagnostic at the end of the file where the closing } is missing
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(endOfFile.translate(0, -1), endOfFile),
                        `Missing closing bracket for '{' at line ${openPos.line + 1}, column ${openPos.character + 1}`,
                        vscode.DiagnosticSeverity.Error
                    );
                    
                    // Add related information pointing to the opening bracket
                    diagnostic.relatedInformation = [
                        new vscode.DiagnosticRelatedInformation(
                            new vscode.Location(document.uri, new vscode.Range(openPos, openPos.translate(0, 1))),
                            'Opening bracket is here'
                        )
                    ];
                    
                    diagnostics.push(diagnostic);
                }
            }
        }

        return diagnostics;
    }

    private checkQuotes(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let singleQuoteStart = -1;
        let doubleQuoteStart = -1;

        for (let i = 0; i < text.length; i++) {
            // Skip escaped quotes
            if (i > 0 && text[i - 1] === '\\') {
                continue;
            }

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
            const pos = document.positionAt(doubleQuoteStart);
            const range = new vscode.Range(pos, pos.translate(0, 1));
            diagnostics.push(new vscode.Diagnostic(
                range,
                'Unclosed double quote',
                vscode.DiagnosticSeverity.Error
            ));
        }

        if (inSingleQuote && singleQuoteStart !== -1) {
            const pos = document.positionAt(singleQuoteStart);
            const range = new vscode.Range(pos, pos.translate(0, 1));
            diagnostics.push(new vscode.Diagnostic(
                range,
                'Unclosed single quote',
                vscode.DiagnosticSeverity.Error
            ));
        }

        return diagnostics;
    }

    private checkFunctions(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        
        // First check for functions without opening parenthesis
        const functionWithoutParenPattern = new RegExp(
            `\\b(${ALL_FUNCTIONS.join('|')})\\b(?!\\s*\\()`,
            'g'
        );
        let match;
        
        while ((match = functionWithoutParenPattern.exec(text)) !== null) {
            const functionName = match[1];
            // Skip if it's inside a string
            const beforeMatch = text.substring(0, match.index);
            const singleQuotes = (beforeMatch.match(/'/g) || []).length;
            const doubleQuotes = (beforeMatch.match(/"/g) || []).length;
            
            if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
                continue;
            }
            
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + functionName.length);
            const range = new vscode.Range(startPos, endPos);
            
            const diagnostic = new vscode.Diagnostic(
                range,
                `Function '${functionName}' is missing its opening parenthesis. Should be '${functionName}('`,
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = 'missing-function-parenthesis';
            diagnostics.push(diagnostic);
        }
        
        // Check for unknown functions
        const functionPattern = /\b([A-Z_][A-Z0-9_]*)\s*\(/g;

        while ((match = functionPattern.exec(text)) !== null) {
            const functionName = match[1];
            if (!ALL_FUNCTIONS.includes(functionName)) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + functionName.length);
                const range = new vscode.Range(startPos, endPos);
                
                // Try to find a close match
                const suggestion = this.findClosestFunction(functionName);
                const message = suggestion 
                    ? `Unknown function '${functionName}'. Did you mean '${suggestion}'?`
                    : `Unknown function '${functionName}'`;
                
                const diagnostic = new vscode.Diagnostic(
                    range,
                    message,
                    vscode.DiagnosticSeverity.Error
                );
                
                // Add code action hint if we have a suggestion
                if (suggestion) {
                    diagnostic.code = {
                        value: 'unknown-function',
                        target: vscode.Uri.parse(`command:airtable-formula.replaceFunction?${encodeURIComponent(JSON.stringify({from: functionName, to: suggestion}))}`)
                    };
                }
                
                diagnostics.push(diagnostic);
            }
        }
        return diagnostics;
    }

    private checkFieldReferences(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        // Disabled empty field reference checking since {} is commonly used in string concatenation
        // for JSON output in Airtable formulas
        return [];
        
        /* Original code kept for reference:
        const diagnostics: vscode.Diagnostic[] = [];
        
        // Check for empty field references
        const emptyFieldRegex = /\{\s*\}/g;
        let match;

        while ((match = emptyFieldRegex.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);
            
            diagnostics.push(new vscode.Diagnostic(
                range,
                'Empty field reference',
                vscode.DiagnosticSeverity.Warning
            ));
        }

        return diagnostics;
        */
    }

    private findClosestFunction(input: string): string | null {
        const inputUpper = input.toUpperCase();
        let minDistance = Infinity;
        let closest: string | null = null;

        for (const func of ALL_FUNCTIONS) {
            const distance = this.levenshteinDistance(inputUpper, func);
            if (distance < minDistance && distance <= 3) { // Only suggest if within 3 edits
                minDistance = distance;
                closest = func;
            }
        }

        return closest;
    }

    private levenshteinDistance(s1: string, s2: string): number {
        const m = s1.length;
        const n = s2.length;
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) {
            dp[i][0] = i;
        }
        for (let j = 0; j <= n; j++) {
            dp[0][j] = j;
        }

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (s1[i - 1] === s2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = 1 + Math.min(
                        dp[i - 1][j],     // deletion
                        dp[i][j - 1],     // insertion
                        dp[i - 1][j - 1]  // substitution
                    );
                }
            }
        }

        return dp[m][n];
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
