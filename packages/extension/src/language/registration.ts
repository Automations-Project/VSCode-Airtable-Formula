import * as vscode from 'vscode';
import { AirtableFormulaDiagnosticsProvider } from './formula/formula-diagnostics';
import { AirtableFormulaCompletionProvider } from './formula/formula-completions';
import { AirtableFormulaHoverProvider } from './formula/formula-hover';
import { AirtableFormulaSignatureHelpProvider } from './formula/formula-signature';
import { AirtableFormulaCodeActionProvider } from '../codeActions';

export function registerLanguageProviders(context: vscode.ExtensionContext): void {
    // Initialize diagnostics provider (per D-01, D-02)
    const diagnosticsProvider = new AirtableFormulaDiagnosticsProvider();
    context.subscriptions.push(diagnosticsProvider);

    context.subscriptions.push(
        // Update diagnostics on document change
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'airtable-formula') {
                diagnosticsProvider.updateDiagnostics(event.document);
            }
        }),
        // Update diagnostics on document open
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'airtable-formula') {
                diagnosticsProvider.updateDiagnostics(document);
            }
        }),
        // Register hover provider
        vscode.languages.registerHoverProvider(
            'airtable-formula',
            new AirtableFormulaHoverProvider()
        ),
        // Register signature help provider
        vscode.languages.registerSignatureHelpProvider(
            'airtable-formula',
            new AirtableFormulaSignatureHelpProvider(),
            '(', ','
        ),
        // Register code actions provider
        vscode.languages.registerCodeActionsProvider(
            'airtable-formula',
            new AirtableFormulaCodeActionProvider(),
            { providedCodeActionKinds: AirtableFormulaCodeActionProvider.providedCodeActionKinds }
        ),
        // Register completion provider
        vscode.languages.registerCompletionItemProvider(
            'airtable-formula',
            new AirtableFormulaCompletionProvider(),
            '(', '{', "'", '"'
        ),
    );

    // Update diagnostics for all documents already open at activation time
    vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'airtable-formula') {
            diagnosticsProvider.updateDiagnostics(document);
        }
    });
}
