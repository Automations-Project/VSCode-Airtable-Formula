import * as vscode from 'vscode';
import { scriptDiagnostics } from '@airtable-formula/language-services';
import { toVscodeDiagnostic } from '../convert';

export class AirtableScriptDiagnosticsProvider implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('airtable-script');
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'airtable-script') return;
        const lsDiags = scriptDiagnostics(document.getText(), document.uri.toString());
        this.diagnosticCollection.set(document.uri, lsDiags.map(toVscodeDiagnostic));
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
