import * as vscode from 'vscode';
import { scriptCompletions } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeCompletionItem } from '../convert';

export class AirtableScriptCompletionProvider implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const lsItems = scriptCompletions(document.getText(), toLsPosition(position));
        return lsItems.map(toVscodeCompletionItem);
    }
}
