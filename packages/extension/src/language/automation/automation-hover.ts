import * as vscode from 'vscode';
import { automationHover } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeHover } from '../convert';

export class AirtableAutomationHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        const lsHover = automationHover(document.getText(), toLsPosition(position));
        return lsHover ? toVscodeHover(lsHover) : null;
    }
}
