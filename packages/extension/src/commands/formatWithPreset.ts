import * as vscode from 'vscode';
import { FormulaFormatter, PresetName } from '../vendor/shared';

/**
 * Preset options for the quick pick menu
 */
const PRESET_OPTIONS: { label: string; value: PresetName; description: string }[] = [
    { 
        label: 'Development', 
        value: 'development', 
        description: 'Human-readable for writing and maintaining formulas' 
    },
    { 
        label: 'Paste Ready', 
        value: 'paste-ready', 
        description: 'Single line, ready to copy into Airtable' 
    },
    { 
        label: 'JSON Builder', 
        value: 'json-builder', 
        description: 'Optimized for formulas that build JSON strings' 
    },
    { 
        label: 'Decision Tree', 
        value: 'decision-tree', 
        description: 'Nested IF chains formatted as cascades' 
    },
    { 
        label: 'Safe Minify', 
        value: 'safe-minify', 
        description: 'Compressed with safe line breaks for long formulas' 
    },
    { 
        label: 'Debug', 
        value: 'debug', 
        description: 'Maximum visibility for troubleshooting' 
    },
];

/**
 * Format with Preset command
 * Uses the new unified FormulaFormatter with semantic presets
 */
export async function formatWithPreset() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const document = editor.document;
    if (document.languageId !== 'airtable-formula') {
        void vscode.window.showWarningMessage('This command only works with Airtable Formula files');
        return;
    }

    // Show quick pick for preset selection
    const selected = await vscode.window.showQuickPick(PRESET_OPTIONS, {
        placeHolder: 'Select formatting preset',
        title: 'Format Airtable Formula'
    });

    if (!selected) {
        return; // User cancelled
    }

    const selection = editor.selection;
    const targetRange = selection && !selection.isEmpty
        ? new vscode.Range(selection.start, selection.end)
        : new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    const source = document.getText(targetRange);

    try {
        const formatter = new FormulaFormatter(selected.value);
        const result = formatter.format(source);
        
        // Show any config warnings
        const warnings = formatter.getWarnings();
        if (warnings.length > 0) {
            console.warn('[FormatWithPreset] Warnings:', warnings);
        }
        
        if (result !== source) {
            await editor.edit(edit => edit.replace(targetRange, result));
            void vscode.window.showInformationMessage(`Formatted with "${selected.label}" preset`);
        } else {
            void vscode.window.showInformationMessage('Formula already formatted');
        }
    } catch (e) {
        console.error('[FormatWithPreset] Error:', e);
        void vscode.window.showErrorMessage(`Format failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

