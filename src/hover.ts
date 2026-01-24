import * as vscode from 'vscode';
import { FUNCTION_REGISTRY, CALLABLE_CONSTANTS, FunctionInfo } from './functions';

/**
 * Provides hover information for Airtable formula functions
 */
export class AirtableFormulaHoverProvider implements vscode.HoverProvider {
    
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        
        // Get the word at the current position (function names are uppercase)
        const wordRange = document.getWordRangeAtPosition(position, /[A-Z_][A-Z0-9_]*/i);
        if (!wordRange) {
            return null;
        }
        
        const word = document.getText(wordRange).toUpperCase();
        
        // Check if it's a known function
        const funcInfo = FUNCTION_REGISTRY[word];
        if (funcInfo) {
            return this.createFunctionHover(word, funcInfo);
        }
        
        // Check if it's a callable constant used without parentheses
        if (CALLABLE_CONSTANTS.includes(word as typeof CALLABLE_CONSTANTS[number])) {
            const constantInfo = FUNCTION_REGISTRY[word];
            if (constantInfo) {
                return this.createFunctionHover(word, constantInfo, true);
            }
        }
        
        // Check for TRUE/FALSE constants
        if (word === 'TRUE' || word === 'FALSE') {
            return new vscode.Hover(
                new vscode.MarkdownString(`**${word}**\n\nBoolean constant representing ${word.toLowerCase()}.`),
                wordRange
            );
        }
        
        return null;
    }
    
    private createFunctionHover(name: string, info: FunctionInfo, isConstant = false): vscode.Hover {
        const md = new vscode.MarkdownString();
        
        // Function signature with syntax highlighting
        md.appendCodeblock(info.signature, 'airtable-formula');
        
        // Description
        md.appendMarkdown(`\n${info.description}\n\n`);
        
        // Category badge
        const categoryEmoji = this.getCategoryEmoji(info.category);
        md.appendMarkdown(`${categoryEmoji} **${info.category}**`);
        
        if (isConstant) {
            md.appendMarkdown(` • Can be used with or without \`()\``);
        }
        
        return new vscode.Hover(md);
    }
    
    private getCategoryEmoji(category: string): string {
        const emojis: Record<string, string> = {
            'Text': '📝',
            'Numeric': '🔢',
            'Date/Time': '📅',
            'Logical': '🔀',
            'Array': '📋',
            'Regex': '🔍',
            'Record': '📄',
            'Misc': '🔧'
        };
        return emojis[category] || '📦';
    }
}
