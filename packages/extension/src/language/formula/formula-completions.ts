import * as vscode from 'vscode';
import { formulaCompletions } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeCompletionItem } from '../convert';
import { stripFormulaHeader } from './formula-header.js';

export class AirtableFormulaCompletionProvider implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const { formula, offset } = stripFormulaHeader(document.getText(), 'formula');
        const adjusted = new vscode.Position(Math.max(0, position.line - offset), position.character);
        const lsItems = formulaCompletions(formula, toLsPosition(adjusted));
        return lsItems.map(toVscodeCompletionItem);
    }
}
