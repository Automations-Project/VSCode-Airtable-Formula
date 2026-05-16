import * as vscode from 'vscode';
import { formulaDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert';
import { stripFormulaHeader } from './formula-header.js';

export class AirtableFormulaDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-formula');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-formula') return;
        const { formula, offset } = stripFormulaHeader(document.getText(), 'formula');
        const lsDiags = formulaDiagnostics(formula, document.uri.toString());
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
