import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AirtableFormulaDiagnosticsProvider } from './diagnostics';
import { AirtableFormulaCompletionProvider } from './completions';

// Types
interface BeautifyOptions {
    style?: 'ultra-compact' | 'compact' | 'readable' | 'json' | 'cascade' | 'smart';
    indent_size?: number;
    max_line_length?: number;
    quote_style?: 'double' | 'single';
    strip_comments?: boolean;
    warn_on_comments?: boolean;
    preserve_empty_field_refs?: boolean;
    smart_line_breaks?: boolean;
}

interface MinifyOptions {
    level?: 'micro' | 'safe' | 'standard' | 'aggressive' | 'extreme';
    preserve_readability?: boolean;
    max_line_length?: number;
    safe_line_breaks?: boolean;
    safe_break_threshold?: number;
}

interface ExtensionSettings {
    scriptRoot?: string;
    beautifierVersion?: 'v1' | 'v2';
    minifierVersion?: 'v1' | 'v2';
    beautify?: {
        style?: BeautifyOptions['style'];
        indentSize?: number;
        maxLineLength?: number;
        quoteStyle?: BeautifyOptions['quote_style'];
    };
    minify?: {
        level?: MinifyOptions['level'];
        preserveReadability?: boolean;
    };
}

type BeautifyFn = (text: string) => string;
type MinifyFn = (text: string) => string;

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "airtable-formula" activated');
    
    // Apply Airtable color scheme
    applyAirtableColors();

    // Initialize diagnostics provider
    const diagnosticsProvider = new AirtableFormulaDiagnosticsProvider();
    context.subscriptions.push(diagnosticsProvider);

    // Update diagnostics on document change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'airtable-formula') {
                diagnosticsProvider.updateDiagnostics(event.document);
            }
        })
    );

    // Update diagnostics on document open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'airtable-formula') {
                diagnosticsProvider.updateDiagnostics(document);
            }
        })
    );

    // Update diagnostics for all open documents
    vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'airtable-formula') {
            diagnosticsProvider.updateDiagnostics(document);
        }
    });

    // Register completion provider
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'airtable-formula',
        new AirtableFormulaCompletionProvider(),
        '(', '{', "'", '"'
    );
    context.subscriptions.push(completionProvider);

    // Register document formatter for .formula language (beautify)
    const formatter = vscode.languages.registerDocumentFormattingEditProvider('airtable-formula', {
        provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
            const original = document.getText();
            const beautify = getBeautifyFunction(document);
            if (!beautify) {
                void vscode.window.showErrorMessage('Beautifier not found. Ensure vendor files exist (dist/vendor) or configure airtableFormula.scriptRoot.');
                return [];
            }
            let formatted: string;
            try {
                formatted = beautify(original);
            } catch (err) {
                console.error(err);
                void vscode.window.showErrorMessage('Beautify failed. See extension host log for details.');
                return [];
            }
            if (formatted === original) {
                return [];
            }
            const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(original.length));
            return [vscode.TextEdit.replace(fullRange, formatted)];
        },
    });

    // Command: Beautify current selection or whole document
    const beautifyCmd = vscode.commands.registerCommand('airtable-formula.beautify', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const document = editor.document;
        const selection = editor.selection;
        const targetRange = selection && !selection.isEmpty
            ? new vscode.Range(selection.start, selection.end)
            : new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        const source = document.getText(targetRange);

        const beautify = getBeautifyFunction(document);
        if (!beautify) {
            void vscode.window.showErrorMessage('Beautifier not found. Ensure vendor files exist (dist/vendor) or configure airtableFormula.scriptRoot.');
            return;
        }

        try {
            const result = beautify(source);
            if (result !== source) {
                await editor.edit(edit => edit.replace(targetRange, result));
            }
        } catch (e) {
            console.error(e);
            void vscode.window.showErrorMessage('Beautify failed. See extension host log for details.');
        }
    });

    // Command: Minify current selection or whole document
    const minifyCmd = vscode.commands.registerCommand('airtable-formula.minify', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const document = editor.document;
        const selection = editor.selection;
        const targetRange = selection && !selection.isEmpty
            ? new vscode.Range(selection.start, selection.end)
            : new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        const source = document.getText(targetRange);

        const minify = getMinifyFunction(document);
        if (!minify) {
            void vscode.window.showErrorMessage('Minifier not found. Ensure vendor files exist (dist/vendor) or configure airtableFormula.scriptRoot.');
            return;
        }

        try {
            const result = minify(source);
            if (result !== source) {
                await editor.edit(edit => edit.replace(targetRange, result));
            }
        } catch (e) {
            console.error(e);
            void vscode.window.showErrorMessage('Minify failed. See extension host log for details.');
        }
    });

    // Explorer context: Beautify file(s) in place
    const beautifyFileCmd = vscode.commands.registerCommand('airtable-formula.beautifyFile', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const targets = (uris && uris.length ? uris : (uri ? [uri] : [])).filter(u => path.extname(u.fsPath).toLowerCase() === '.formula');
        if (!targets.length) {
            void vscode.window.showWarningMessage('No .formula files selected');
            return;
        }
        let ok = 0, fail = 0;
        for (const u of targets) {
            try {
                const doc = await vscode.workspace.openTextDocument(u);
                const beautify = getBeautifyFunction(doc);
                if (!beautify) {
                    throw new Error('Beautifier not found');
                }
                const source = doc.getText();
                const result = beautify(source);
                if (result !== source) {
                    await vscode.workspace.fs.writeFile(u, Buffer.from(result, 'utf8'));
                    ok++;
                }
            } catch (e) {
                console.error('Beautify file failed for', u.fsPath, e);
                fail++;
            }
        }
        void vscode.window.showInformationMessage(`Beautified ${ok} file(s)` + (fail ? `, ${fail} failed` : ''));
    });

    // Explorer context: Minify file(s) to new .min.formula (or .ultra-min.formula for extreme)
    const minifyFileCmd = vscode.commands.registerCommand('airtable-formula.minifyFile', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const targets = (uris && uris.length ? uris : (uri ? [uri] : [])).filter(u => path.extname(u.fsPath).toLowerCase() === '.formula');
        if (!targets.length) {
            void vscode.window.showWarningMessage('No .formula files selected');
            return;
        }
        let ok = 0, fail = 0;
        for (const u of targets) {
            try {
                const doc = await vscode.workspace.openTextDocument(u);
                const minify = getMinifyFunction(doc);
                if (!minify) {
                    throw new Error('Minifier not found');
                }
                const source = doc.getText();
                const result = minify(source);
                const cfg = getConfig(doc);
                const suffix = (cfg.minify?.level === 'extreme') ? '.ultra-min' : '.min';
                const parsed = path.parse(u.fsPath);
                const outPath = path.join(parsed.dir, `${parsed.name}${suffix}.formula`);
                const outUri = vscode.Uri.file(outPath);
                await vscode.workspace.fs.writeFile(outUri, Buffer.from(result, 'utf8'));
                ok++;
            } catch (e) {
                console.error('Minify file failed for', u?.fsPath, e);
                fail++;
            }
        }
        void vscode.window.showInformationMessage(`Minified ${ok} file(s)` + (fail ? `, ${fail} failed` : ''));
    });

    context.subscriptions.push(formatter, beautifyCmd, minifyCmd, beautifyFileCmd, minifyFileCmd);
}

export function deactivate() {}

// Apply Airtable-style colors to the editor
function applyAirtableColors() {
    const config = vscode.workspace.getConfiguration();
    const tokenColorCustomizations = config.get<any>('editor.tokenColorCustomizations') || {};
    
    // Add or update Airtable formula colors
    if (!tokenColorCustomizations.textMateRules) {
        tokenColorCustomizations.textMateRules = [];
    }
    
    const airtableRules = [
        {
            scope: [
                'entity.name.function.text.airtable-formula',
                'entity.name.function.numeric.airtable-formula',
                'entity.name.function.datetime.airtable-formula',
                'entity.name.function.logical.airtable-formula',
                'entity.name.function.array.airtable-formula',
                'entity.name.function.regex.airtable-formula',
                'entity.name.function.record.airtable-formula',
                'entity.name.function.misc.airtable-formula'
            ],
            settings: {
                foreground: '#7fe095'
            }
        },
        {
            scope: [
                'variable.other.field.airtable-formula',
                'entity.name.field.airtable-formula'
            ],
            settings: {
                foreground: '#b2aefc'
            }
        },
        {
            scope: [
                'string.quoted.double.airtable-formula',
                'string.quoted.single.airtable-formula',
                'constant.numeric.airtable-formula'
            ],
            settings: {
                foreground: '#61ebe1'
            }
        },
        {
            scope: [
                'constant.language.boolean.airtable-formula',
                'constant.language.datetime.airtable-formula',
                'support.constant.datetime.airtable-formula'
            ],
            settings: {
                foreground: '#61ebe1'
            }
        }
    ];
    
    // Remove existing Airtable rules and add new ones
    const filteredRules = tokenColorCustomizations.textMateRules.filter(
        (rule: any) => !rule.scope?.some?.((s: string) => s.includes('airtable-formula'))
    );
    
    tokenColorCustomizations.textMateRules = [...filteredRules, ...airtableRules];
    
    // Apply the configuration
    config.update(
        'editor.tokenColorCustomizations',
        tokenColorCustomizations,
        vscode.ConfigurationTarget.Global
    ).then(
        () => console.log('Airtable colors applied successfully'),
        (err) => console.error('Failed to apply Airtable colors:', err)
    );
}

// ------------------ Helpers ------------------
function getConfig(document?: vscode.TextDocument): ExtensionSettings {
    const cfg = vscode.workspace.getConfiguration('airtableFormula', document);
    return {
        scriptRoot: cfg.get<string>('scriptRoot'),
        beautifierVersion: cfg.get<'v1' | 'v2'>('beautifierVersion', 'v2'),
        minifierVersion: cfg.get<'v1' | 'v2'>('minifierVersion', 'v2'),
        beautify: {
            style: cfg.get('beautify.style'),
            indentSize: cfg.get('beautify.indentSize'),
            maxLineLength: cfg.get('beautify.maxLineLength'),
            quoteStyle: cfg.get('beautify.quoteStyle'),
        },
        minify: {
            level: cfg.get('minify.level'),
            preserveReadability: cfg.get('minify.preserveReadability'),
        },
    };
}

function resolveScriptPath(document: vscode.TextDocument, fileName: string): string | null {
    // 1) Prefer bundled vendor in dist
    const distVendor = path.join(__dirname, 'vendor', fileName);
    if (fs.existsSync(distVendor)) {
        return distVendor;
    }

    // 2) Dev mode: use src/vendor next to source
    const srcVendor = path.join(__dirname, '..', 'src', 'vendor', fileName);
    if (fs.existsSync(srcVendor)) {
        return srcVendor;
    }

    // 3) Legacy config / workspace fallback (draft/scripts or configured path)
    const settings = getConfig(document);
    const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
    const wsPath = wsFolder?.uri.fsPath;

    let root = settings.scriptRoot || (wsPath ? path.join(wsPath, 'draft', 'scripts') : '');
    if (wsPath && root.includes('${workspaceFolder}')) {
        root = root.replace('${workspaceFolder}', wsPath);
    }

    if (!root) {
        return null;
    }
    const fullPath = path.join(root, fileName);
    if (fs.existsSync(fullPath)) {
        return fullPath;
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const candidate = path.join(folder.uri.fsPath, 'draft', 'scripts', fileName);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function getBeautifyFunction(document: vscode.TextDocument): BeautifyFn | null {
    const settings = getConfig(document);
    const version = settings.beautifierVersion || 'v2';
    
    // Determine which file to load based on version setting
    const fileName = version === 'v2' ? 'formula-beautifier-v2.js' : 'formula-beautifier.js';
    const beautifierPath = resolveScriptPath(document, fileName);
    
    // If v2 is selected but not found, fall back to v1
    let fallbackPath: string | null = null;
    if (!beautifierPath && version === 'v2') {
        fallbackPath = resolveScriptPath(document, 'formula-beautifier.js');
        if (fallbackPath) {
            console.warn('Beautifier v2 not found, falling back to v1');
        }
    }
    
    const finalPath = beautifierPath || fallbackPath;
    if (!finalPath) {
        return null;
    }

    const req = (eval('require')) as (id: string) => any; // runtime require to avoid bundling
    let BeautifierClass: any;
    try {
        BeautifierClass = req(finalPath);
    } catch (e) {
        console.error('Failed loading beautifier:', e);
        return null;
    }

    const options: BeautifyOptions = {
        max_line_length: settings.beautify?.maxLineLength ?? 120,
        quote_style: (settings.beautify?.quoteStyle as any) ?? 'double',
        indent_size: settings.beautify?.indentSize ?? 1,
        style: (settings.beautify?.style as any) ?? 'compact',
    } as any;

    try {
        const instance = new BeautifierClass(options);
        if (typeof instance.beautify === 'function') {
            return (text: string) => instance.beautify(text);
        }
    } catch (e) {
        console.error('Error creating beautifier instance:', e);
    }
    return null;
}

function getMinifyFunction(document: vscode.TextDocument): MinifyFn | null {
    const settings = getConfig(document);
    const version = settings.minifierVersion || 'v2';
    
    // Determine which file to load based on version setting
    const fileName = version === 'v2' ? 'formula-minifier-v2.js' : 'formula-minifier.js';
    const minifierPath = resolveScriptPath(document, fileName);
    
    // If v2 is selected but not found, fall back to v1
    let fallbackPath: string | null = null;
    if (!minifierPath && version === 'v2') {
        fallbackPath = resolveScriptPath(document, 'formula-minifier.js');
        if (fallbackPath) {
            console.warn('Minifier v2 not found, falling back to v1');
        }
    }
    
    const finalPath = minifierPath || fallbackPath;
    if (!finalPath) {
        return null;
    }

    const req = (eval('require')) as (id: string) => any;
    let MinifierClass: any;
    try {
        MinifierClass = req(finalPath);
    } catch (e) {
        console.error('Failed loading minifier:', e);
        return null;
    }
    const options: MinifyOptions = {
        level: (settings.minify?.level as any) ?? 'standard',
        preserve_readability: settings.minify?.preserveReadability ?? false,
    } as any;

    try {
        const instance = new MinifierClass(options);
        if (typeof instance.minify === 'function') {
            return (text: string) => instance.minify(text);
        }
    } catch (e) {
        console.error('Error creating minifier instance:', e);
    }
    return null;
}
