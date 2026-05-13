import * as vscode from 'vscode';
import { AirtableFormulaDiagnosticsProvider } from './formula/formula-diagnostics';
import { AirtableFormulaCompletionProvider } from './formula/formula-completions';
import { AirtableFormulaHoverProvider } from './formula/formula-hover';
import { AirtableFormulaSignatureHelpProvider } from './formula/formula-signature';
import { AirtableFormulaCodeActionProvider } from '../codeActions';
import { AirtableScriptDiagnosticsProvider } from './script/script-diagnostics';
import { AirtableScriptCompletionProvider } from './script/script-completions';
import { AirtableScriptHoverProvider } from './script/script-hover';
import { AirtableAutomationDiagnosticsProvider } from './automation/automation-diagnostics';
import { AirtableAutomationCompletionProvider } from './automation/automation-completions';
import { AirtableAutomationHoverProvider } from './automation/automation-hover';

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

    // Script providers — same lifecycle pattern as formula providers above
    const scriptDiagnosticsProvider = new AirtableScriptDiagnosticsProvider();
    context.subscriptions.push(scriptDiagnosticsProvider);

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'airtable-script') {
                scriptDiagnosticsProvider.updateDiagnostics(event.document);
            }
        }),
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'airtable-script') {
                scriptDiagnosticsProvider.updateDiagnostics(document);
            }
        }),
        vscode.languages.registerHoverProvider(
            'airtable-script',
            new AirtableScriptHoverProvider()
        ),
        vscode.languages.registerCompletionItemProvider(
            'airtable-script',
            new AirtableScriptCompletionProvider(),
            '.'   // dot trigger for method completions
        ),
    );

    vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'airtable-script') {
            scriptDiagnosticsProvider.updateDiagnostics(document);
        }
    });

    // Automation providers — same lifecycle pattern as script providers above
    const automationDiagnosticsProvider = new AirtableAutomationDiagnosticsProvider();
    context.subscriptions.push(automationDiagnosticsProvider);

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'airtable-automation') {
                automationDiagnosticsProvider.updateDiagnostics(event.document);
            }
        }),
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'airtable-automation') {
                automationDiagnosticsProvider.updateDiagnostics(document);
            }
        }),
        vscode.languages.registerHoverProvider(
            'airtable-automation',
            new AirtableAutomationHoverProvider()
        ),
        vscode.languages.registerCompletionItemProvider(
            'airtable-automation',
            new AirtableAutomationCompletionProvider(),
            '.'   // dot trigger for method completions
        ),
    );

    vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'airtable-automation') {
            automationDiagnosticsProvider.updateDiagnostics(document);
        }
    });
}
