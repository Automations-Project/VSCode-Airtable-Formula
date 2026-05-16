import * as vscode from 'vscode';
import { automationHover } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeHover } from '../convert';
import { stripFormulaHeader } from '../formula/formula-header.js';

export class AirtableAutomationHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        const { formula, offset } = stripFormulaHeader(document.getText(), 'automation');
        const adjusted = new vscode.Position(Math.max(0, position.line - offset), position.character);
        const lsHover = automationHover(formula, toLsPosition(adjusted));
        return lsHover ? toVscodeHover(lsHover) : null;
    }
}
