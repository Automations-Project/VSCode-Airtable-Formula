import * as vscode from 'vscode';
import { automationDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert';
import { stripFormulaHeader } from '../formula/formula-header.js';

export class AirtableAutomationDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-automation');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-automation') return;
        const { formula, offset } = stripFormulaHeader(document.getText(), 'automation');
        const lsDiags = automationDiagnostics(formula, document.uri.toString());
        const shifted = lsDiags.map(d => {
            const diag = toVscodeDiagnostic(d);
            const start = new vscode.Position(diag.range.start.line + offset, diag.range.start.character);
            const end   = new vscode.Position(diag.range.end.line   + offset, diag.range.end.character);
            return new vscode.Diagnostic(new vscode.Range(start, end), diag.message, diag.severity);
        });
        this.diagnosticCollection.set(document.uri, shifted);
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
