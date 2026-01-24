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
        'ROUND', 'ROUNDDOWN', 'ROUNDUP', 'SQRT', 'SUM', 'ODD', 'EVEN'
    ],
    datetime: [
        'DATEADD', 'DATEDIF', 'DATETIME_DIFF', 'DATETIME_FORMAT', 'DATETIME_PARSE',
        'DATESTR', 'DAY', 'HOUR', 'MINUTE', 'MONTH', 'NOW', 'SECOND', 'SET_LOCALE',
        'SET_TIMEZONE', 'TIMESTR', 'TODAY', 'TONOW', 'FROMNOW', 'WEEKDAY', 'WEEKNUM',
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
        'RECORD_ID', 'CREATED_TIME', 'LAST_MODIFIED_TIME'
    ],
    misc: [
        'ENCODE_URL_COMPONENT', 'BLANK'
    ]
};

// Flatten all functions into a single array for easy lookup
const ALL_FUNCTIONS = Object.values(AIRTABLE_FUNCTIONS).flat();

// Constants that can be used with or without parentheses
const CALLABLE_CONSTANTS = ['NOW', 'TODAY', 'BLANK', 'TRUE', 'FALSE'];

// All valid identifiers that can be called with parentheses
const ALL_CALLABLE = [...ALL_FUNCTIONS, ...CALLABLE_CONSTANTS];

// Smart quotes that should be replaced with straight quotes
const SMART_QUOTES: Record<string, string> = {
    '\u201C': '"', // "
    '\u201D': '"', // "
    '\u2018': "'", // '
    '\u2019': "'", // '
};

// Common typos and Excel functions that don't exist in Airtable
const COMMON_TYPOS: Record<string, string> = {
    'CONCATINATE': 'CONCATENATE',
    'CONCATNATE': 'CONCATENATE',
    'SUBSTITUDE': 'SUBSTITUTE',
    'SUBSTUTE': 'SUBSTITUTE',
    'SUMIF': 'SUM (SUMIF not available)',
    'COUNTIF': 'COUNT (COUNTIF not available)',
    'VLOOKUP': 'linked records (VLOOKUP not available)',
    'HLOOKUP': 'linked records (HLOOKUP not available)',
    'INDEX': 'ARRAYSLICE',
    'IFERROR': 'IF(ISERROR(...), ...)',
    'ISBLANK': 'IF({Field}, FALSE, TRUE)',
    'DATEVALUE': 'DATETIME_PARSE',
    'TIMEVALUE': 'DATETIME_PARSE',
    'DATEDIFF': 'DATETIME_DIFF',
    'CONCAT': 'CONCATENATE or &',
};

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
        
        // Enhanced diagnostics from research
        diagnostics.push(...this.checkSmartQuotes(document, text));
        diagnostics.push(...this.checkCommonTypos(document, text));
        diagnostics.push(...this.checkDivisionByZero(document, text));
        diagnostics.push(...this.checkNestedIfs(document, text));
        diagnostics.push(...this.checkTrailingOperators(document, text));

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
        
        // Get ranges to exclude from function checking (field refs, strings, comments)
        const exclusionRanges = this.getExclusionRanges(text);
        
        // First check for functions without opening parenthesis
        const functionWithoutParenPattern = new RegExp(
            `\\b(${ALL_FUNCTIONS.join('|')})\\b(?!\\s*\\()`,
            'g'
        );
        let match;
        
        while ((match = functionWithoutParenPattern.exec(text)) !== null) {
            const functionName = match[1];
            
            // Skip if inside exclusion range
            if (this.isInsideExclusionRange(match.index, exclusionRanges)) {
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
            
            // Skip if inside exclusion range
            if (this.isInsideExclusionRange(match.index, exclusionRanges)) {
                continue;
            }
            
            // Check against all valid callable identifiers (functions + constants)
            if (!ALL_CALLABLE.includes(functionName)) {
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

    /**
     * Get ranges that should be excluded from function validation.
     * This includes: field references {}, strings "", '', and comments.
     */
    private getExclusionRanges(text: string): Array<{start: number, end: number}> {
        const ranges: Array<{start: number, end: number}> = [];
        
        // Match field references: {...}
        const fieldRefRegex = /\{[^{}]*\}/g;
        let match;
        while ((match = fieldRefRegex.exec(text)) !== null) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }
        
        // Match double-quoted strings: "..."
        const doubleQuoteRegex = /"(?:[^"\\]|\\.)*"/g;
        while ((match = doubleQuoteRegex.exec(text)) !== null) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }
        
        // Match single-quoted strings: '...'
        const singleQuoteRegex = /'(?:[^'\\]|\\.)*'/g;
        while ((match = singleQuoteRegex.exec(text)) !== null) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }
        
        // Match single-line comments: //...
        const singleLineCommentRegex = /\/\/.*/g;
        while ((match = singleLineCommentRegex.exec(text)) !== null) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }
        
        // Match block comments: /*...*/
        const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
        while ((match = blockCommentRegex.exec(text)) !== null) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }
        
        return ranges;
    }

    /**
     * Check if a position falls within any exclusion range.
     */
    private isInsideExclusionRange(position: number, ranges: Array<{start: number, end: number}>): boolean {
        return ranges.some(range => position >= range.start && position < range.end);
    }

    private findClosestFunction(input: string): string | null {
        const inputUpper = input.toUpperCase();
        let minDistance = Infinity;
        let closest: string | null = null;

        // Search against all callable identifiers (functions + constants)
        for (const func of ALL_CALLABLE) {
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

    /**
     * Check for smart quotes (curly quotes) that Airtable doesn't accept
     */
    private checkSmartQuotes(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        
        for (const [smartQuote, replacement] of Object.entries(SMART_QUOTES)) {
            let index = text.indexOf(smartQuote);
            while (index !== -1) {
                const pos = document.positionAt(index);
                const range = new vscode.Range(pos, pos.translate(0, 1));
                
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Smart quote detected. Replace with straight quote: ${replacement}`,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.code = 'smart-quote';
                diagnostics.push(diagnostic);
                
                index = text.indexOf(smartQuote, index + 1);
            }
        }
        
        return diagnostics;
    }

    /**
     * Check for common typos and Excel functions that don't exist in Airtable
     */
    private checkCommonTypos(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const exclusionRanges = this.getExclusionRanges(text);
        
        for (const [typo, suggestion] of Object.entries(COMMON_TYPOS)) {
            const pattern = new RegExp(`\\b${typo}\\s*\\(`, 'gi');
            let match;
            
            while ((match = pattern.exec(text)) !== null) {
                if (this.isInsideExclusionRange(match.index, exclusionRanges)) continue;
                
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + typo.length);
                
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(startPos, endPos),
                    `'${typo}' is not an Airtable function. Use ${suggestion}`,
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.code = 'common-typo';
                diagnostics.push(diagnostic);
            }
        }
        
        return diagnostics;
    }

    /**
     * Check for potential division by zero issues
     */
    private checkDivisionByZero(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const exclusionRanges = this.getExclusionRanges(text);
        
        // Pattern: field or number divided by field (potential zero)
        const divisionPattern = /(\{[^}]+\}|\d+(?:\.\d+)?)\s*\/\s*(\{[^}]+\})/g;
        let match;
        
        while ((match = divisionPattern.exec(text)) !== null) {
            if (this.isInsideExclusionRange(match.index, exclusionRanges)) continue;
            
            // Look backwards for IF( that might be guarding this division
            const lookback = Math.max(0, match.index - 100);
            const context = text.slice(lookback, match.index);
            
            // Skip if there's a zero check nearby
            const hasGuard = /IF\s*\([^)]*(?:=\s*0|!=\s*0|ISERROR)/i.test(context);
            
            if (!hasGuard) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                const divisor = match[2];
                
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(startPos, endPos),
                    `Potential division by zero. Consider: IF(${divisor}=0, BLANK(), ${match[0]})`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.code = 'division-by-zero';
                diagnostics.push(diagnostic);
            }
        }
        
        return diagnostics;
    }

    /**
     * Check for deeply nested IF statements that could use SWITCH
     */
    private checkNestedIfs(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        
        let maxDepth = 0;
        let currentDepth = 0;
        let deepestStart = 0;
        
        // Track IF nesting depth
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
            const startPos = document.positionAt(deepestStart);
            const endPos = document.positionAt(Math.min(deepestStart + 20, text.length));
            
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(startPos, endPos),
                `Deeply nested IF (${maxDepth} levels). Consider using SWITCH() for better readability.`,
                vscode.DiagnosticSeverity.Information
            );
            diagnostic.code = 'nested-if';
            diagnostics.push(diagnostic);
        }
        
        return diagnostics;
    }

    /**
     * Check for trailing operators that indicate incomplete expressions
     */
    private checkTrailingOperators(document: vscode.TextDocument, text: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        
        const trimmed = text.trim();
        const trailingOpMatch = trimmed.match(/[+\-*/&,]\s*$/);
        
        if (trailingOpMatch) {
            const index = text.lastIndexOf(trailingOpMatch[0].trim());
            const pos = document.positionAt(index);
            
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(pos, pos.translate(0, 1)),
                'Trailing operator - expression appears incomplete',
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = 'trailing-operator';
            diagnostics.push(diagnostic);
        }
        
        return diagnostics;
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
