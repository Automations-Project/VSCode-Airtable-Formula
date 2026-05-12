import * as vscode from 'vscode';
import { formulaSignatureHelp } from '@airtable-formula/language-services';
import { toLsPosition, toVscodeSignatureHelp } from '../convert';

export class AirtableFormulaSignatureHelpProvider implements vscode.SignatureHelpProvider {
    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.SignatureHelpContext
    ): vscode.SignatureHelp | null {
        const lsHelp = formulaSignatureHelp(document.getText(), toLsPosition(position));
        return lsHelp ? toVscodeSignatureHelp(lsHelp) : null;
    }
}
