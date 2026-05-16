import * as vscode from 'vscode';
import { scriptCompletions } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeCompletionItem } from '../convert';
import { stripFormulaHeader } from '../formula/formula-header.js';

export class AirtableScriptCompletionProvider implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const { formula, offset } = stripFormulaHeader(document.getText(), 'script');
        const adjusted = new vscode.Position(Math.max(0, position.line - offset), position.character);
        const lsItems = scriptCompletions(formula, toLsPosition(adjusted));
        return lsItems.map(toVscodeCompletionItem);
    }
}
