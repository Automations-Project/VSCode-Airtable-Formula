import * as vscode from 'vscode';
import { formulaHover } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeHover } from '../convert';

export class AirtableFormulaHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | null {
        const lsHover = formulaHover(document.getText(), toLsPosition(position));
        return lsHover ? toVscodeHover(lsHover) : null;
    }
}
