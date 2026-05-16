import * as vscode from 'vscode';
import { formulaHover } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeHover } from '../convert';
import { stripFormulaHeader } from './formula-header.js';

export class AirtableFormulaHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        const { formula, offset } = stripFormulaHeader(document.getText(), 'formula');
        const adjusted = new vscode.Position(Math.max(0, position.line - offset), position.character);
        const lsHover = formulaHover(formula, toLsPosition(adjusted));
        return lsHover ? toVscodeHover(lsHover) : null;
    }
}
