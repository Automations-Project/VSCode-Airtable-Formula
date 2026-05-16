import * as vscode from 'vscode';
import { formulaSignatureHelp } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeSignatureHelp } from '../convert';
import { stripFormulaHeader } from './formula-header.js';

export class AirtableFormulaSignatureHelpProvider implements vscode.SignatureHelpProvider {
    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.SignatureHelpContext
    ): vscode.SignatureHelp | null {
        const { formula, offset } = stripFormulaHeader(document.getText(), 'formula');
        const adjusted = new vscode.Position(Math.max(0, position.line - offset), position.character);
        const lsHelp = formulaSignatureHelp(formula, toLsPosition(adjusted));
        return lsHelp ? toVscodeSignatureHelp(lsHelp) : null;
    }
}
