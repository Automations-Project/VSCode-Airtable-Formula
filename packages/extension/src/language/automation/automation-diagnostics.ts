import * as vscode from 'vscode';
import { automationDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert';

export class AirtableAutomationDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-automation');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-automation') return;
        const lsDiags = automationDiagnostics(document.getText(), document.uri.toString());
        this.diagnosticCollection.set(document.uri, lsDiags.map(toVscodeDiagnostic));
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
