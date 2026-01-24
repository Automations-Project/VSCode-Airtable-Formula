import * as vscode from 'vscode';
import { ALL_CALLABLE, FUNCTION_REGISTRY } from './functions';

/**
 * Provides code actions (quick fixes) for Airtable formula diagnostics
 */
export class AirtableFormulaCodeActionProvider implements vscode.CodeActionProvider {
    
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];
    
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        
        const actions: vscode.CodeAction[] = [];
        
        for (const diagnostic of context.diagnostics) {
            // Handle "Unknown function" diagnostics
            if (diagnostic.message.includes('Unknown function')) {
                const suggestedFix = this.extractSuggestion(diagnostic.message);
                if (suggestedFix) {
                    const action = this.createReplaceFunctionAction(document, diagnostic, suggestedFix);
                    if (action) {
                        actions.push(action);
                    }
                }
                
                // Also offer to wrap in field reference if it might be a field name
                const unknownName = this.extractUnknownFunction(diagnostic.message);
                if (unknownName) {
                    const fieldAction = this.createWrapAsFieldAction(document, diagnostic, unknownName);
                    if (fieldAction) {
                        actions.push(fieldAction);
                    }
                }
            }
            
            // Handle "missing opening parenthesis" diagnostics
            if (diagnostic.message.includes('missing its opening parenthesis')) {
                const action = this.createAddParenthesisAction(document, diagnostic);
                if (action) {
                    actions.push(action);
                }
            }
            
            // Handle "Comments are not allowed" diagnostics
            if (diagnostic.message.includes('Comments are not allowed')) {
                const action = this.createRemoveCommentAction(document, diagnostic);
                if (action) {
                    actions.push(action);
                }
            }
            
            // Handle smart quotes
            if (diagnostic.code === 'smart-quote') {
                const action = this.createReplaceSmartQuoteAction(document, diagnostic);
                if (action) {
                    actions.push(action);
                }
                // Offer "Fix all smart quotes" if multiple exist
                const smartQuoteDiagnostics = context.diagnostics.filter(d => d.code === 'smart-quote');
                if (smartQuoteDiagnostics.length > 1) {
                    const fixAllAction = this.createReplaceAllSmartQuotesAction(document, smartQuoteDiagnostics);
                    if (fixAllAction) {
                        actions.push(fixAllAction);
                    }
                }
            }
            
            // Handle division by zero
            if (diagnostic.code === 'division-by-zero') {
                const action = this.createDivisionGuardAction(document, diagnostic);
                if (action) {
                    actions.push(action);
                }
            }
            
            // Handle common typos
            if (diagnostic.code === 'common-typo') {
                const action = this.createTypoFixAction(document, diagnostic);
                if (action) {
                    actions.push(action);
                }
            }
        }
        
        return actions;
    }
    
    /**
     * Extract the suggested function name from diagnostic message
     */
    private extractSuggestion(message: string): string | null {
        const match = message.match(/Did you mean '([A-Z_][A-Z0-9_]*)'\?/i);
        return match ? match[1] : null;
    }
    
    /**
     * Extract the unknown function name from diagnostic message
     */
    private extractUnknownFunction(message: string): string | null {
        const match = message.match(/Unknown function '([A-Z_][A-Z0-9_]*)'/i);
        return match ? match[1] : null;
    }
    
    /**
     * Create action to replace unknown function with suggested one
     */
    private createReplaceFunctionAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        suggestion: string
    ): vscode.CodeAction | null {
        const action = new vscode.CodeAction(
            `Replace with '${suggestion}'`,
            vscode.CodeActionKind.QuickFix
        );
        
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, diagnostic.range, suggestion);
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        
        return action;
    }
    
    /**
     * Create action to wrap text as field reference
     */
    private createWrapAsFieldAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        fieldName: string
    ): vscode.CodeAction | null {
        // Don't suggest if it looks like a real function name
        if (ALL_CALLABLE.includes(fieldName.toUpperCase())) {
            return null;
        }
        
        const action = new vscode.CodeAction(
            `Wrap as field reference: {${fieldName}}`,
            vscode.CodeActionKind.QuickFix
        );
        
        // Get the full text around the diagnostic to find if there's a ( after
        const lineText = document.lineAt(diagnostic.range.start.line).text;
        const startChar = diagnostic.range.start.character;
        const endChar = diagnostic.range.end.character;
        
        // Check if followed by (
        let replaceEnd = endChar;
        if (lineText[endChar] === '(') {
            // Find matching )
            let depth = 1;
            let i = endChar + 1;
            while (i < lineText.length && depth > 0) {
                if (lineText[i] === '(') depth++;
                if (lineText[i] === ')') depth--;
                i++;
            }
            replaceEnd = i;
        }
        
        const replaceRange = new vscode.Range(
            diagnostic.range.start.line,
            startChar,
            diagnostic.range.start.line,
            replaceEnd
        );
        
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, replaceRange, `{${fieldName}}`);
        action.diagnostics = [diagnostic];
        
        return action;
    }
    
    /**
     * Create action to add missing parenthesis
     */
    private createAddParenthesisAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const text = document.getText(diagnostic.range);
        
        const action = new vscode.CodeAction(
            `Add parenthesis: ${text}()`,
            vscode.CodeActionKind.QuickFix
        );
        
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, diagnostic.range, `${text}()`);
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        
        return action;
    }
    
    /**
     * Create action to remove comment
     */
    private createRemoveCommentAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const lineNum = diagnostic.range.start.line;
        const lineText = document.lineAt(lineNum).text;
        
        // Check for line comment
        const lineCommentIndex = lineText.indexOf('//');
        if (lineCommentIndex !== -1) {
            const action = new vscode.CodeAction(
                'Remove comment',
                vscode.CodeActionKind.QuickFix
            );
            
            // Remove from // to end of line
            const range = new vscode.Range(
                lineNum,
                lineCommentIndex,
                lineNum,
                lineText.length
            );
            
            action.edit = new vscode.WorkspaceEdit();
            action.edit.delete(document.uri, range);
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            
            return action;
        }
        
        // Check for block comment
        const blockStart = lineText.indexOf('/*');
        if (blockStart !== -1) {
            const blockEnd = lineText.indexOf('*/');
            if (blockEnd !== -1) {
                const action = new vscode.CodeAction(
                    'Remove comment',
                    vscode.CodeActionKind.QuickFix
                );
                
                const range = new vscode.Range(
                    lineNum,
                    blockStart,
                    lineNum,
                    blockEnd + 2
                );
                
                action.edit = new vscode.WorkspaceEdit();
                action.edit.delete(document.uri, range);
                action.diagnostics = [diagnostic];
                action.isPreferred = true;
                
                return action;
            }
        }
        
        return null;
    }

    /**
     * Create action to replace smart quote with straight quote
     */
    private createReplaceSmartQuoteAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const text = document.getText(diagnostic.range);
        const replacement = text === '\u201C' || text === '\u201D' ? '"' : "'";
        
        const action = new vscode.CodeAction(
            `Replace with ${replacement}`,
            vscode.CodeActionKind.QuickFix
        );
        
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, diagnostic.range, replacement);
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        
        return action;
    }

    /**
     * Create action to fix all smart quotes in document
     */
    private createReplaceAllSmartQuotesAction(
        document: vscode.TextDocument,
        diagnostics: vscode.Diagnostic[]
    ): vscode.CodeAction | null {
        if (diagnostics.length < 2) return null;
        
        const action = new vscode.CodeAction(
            `Fix all ${diagnostics.length} smart quotes`,
            vscode.CodeActionKind.QuickFix
        );
        
        action.edit = new vscode.WorkspaceEdit();
        for (const diag of diagnostics) {
            const text = document.getText(diag.range);
            const replacement = text === '\u201C' || text === '\u201D' ? '"' : "'";
            action.edit.replace(document.uri, diag.range, replacement);
        }
        action.diagnostics = diagnostics;
        
        return action;
    }

    /**
     * Create action to wrap division in IF guard
     */
    private createDivisionGuardAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const text = document.getText(diagnostic.range);
        const parts = text.split('/').map(s => s.trim());
        
        if (parts.length !== 2) return null;
        
        const [numerator, denominator] = parts;
        const safeDivision = `IF(${denominator}=0, BLANK(), ${numerator}/${denominator})`;
        
        const action = new vscode.CodeAction(
            'Add zero-division guard',
            vscode.CodeActionKind.QuickFix
        );
        
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, diagnostic.range, safeDivision);
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        
        return action;
    }

    /**
     * Create action to show typo fix hint
     */
    private createTypoFixAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        // Extract the suggestion from the diagnostic message
        const match = diagnostic.message.match(/Use (.+)$/);
        if (!match) return null;
        
        const suggestion = match[1];
        
        const action = new vscode.CodeAction(
            `See suggestion: ${suggestion}`,
            vscode.CodeActionKind.QuickFix
        );
        
        // This is informational - no auto-fix since suggestions vary
        action.diagnostics = [diagnostic];
        
        return action;
    }
}
