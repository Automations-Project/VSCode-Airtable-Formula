import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Types
interface BeautifyOptions {
    style?: 'ultra-compact' | 'compact' | 'readable' | 'json' | 'cascade';
    indent_size?: number;
    max_line_length?: number;
    quote_style?: 'double' | 'single';
}

interface MinifyOptions {
    level?: 'micro' | 'standard' | 'aggressive' | 'extreme';
    preserve_readability?: boolean;
}

interface ExtensionSettings {
    scriptRoot?: string;
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
            if (formatted === original) return [];
            const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(original.length));
            return [vscode.TextEdit.replace(fullRange, formatted)];
        },
    });

    // Command: Beautify current selection or whole document
    const beautifyCmd = vscode.commands.registerCommand('airtable-formula.beautify', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
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
        if (!editor) { return; }
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

// ------------------ Helpers ------------------
function getConfig(document?: vscode.TextDocument): ExtensionSettings {
    const cfg = vscode.workspace.getConfiguration('airtableFormula', document);
    return {
        scriptRoot: cfg.get<string>('scriptRoot'),
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
    if (fs.existsSync(distVendor)) return distVendor;

    // 2) Dev mode: use src/vendor next to source
    const srcVendor = path.join(__dirname, '..', 'src', 'vendor', fileName);
    if (fs.existsSync(srcVendor)) return srcVendor;

    // 3) Legacy config / workspace fallback (draft/scripts or configured path)
    const settings = getConfig(document);
    const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
    const wsPath = wsFolder?.uri.fsPath;

    let root = settings.scriptRoot || (wsPath ? path.join(wsPath, 'draft', 'scripts') : '');
    if (wsPath && root.includes('${workspaceFolder}')) {
        root = root.replace('${workspaceFolder}', wsPath);
    }

    if (!root) { return null; }
    const fullPath = path.join(root, fileName);
    if (fs.existsSync(fullPath)) return fullPath;

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const candidate = path.join(folder.uri.fsPath, 'draft', 'scripts', fileName);
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
}

function getBeautifyFunction(document: vscode.TextDocument): BeautifyFn | null {
    const beautifierPath = resolveScriptPath(document, 'formula-beautifier.js');
    if (!beautifierPath) return null;

    const req = (eval('require')) as (id: string) => any; // runtime require to avoid bundling
    let BeautifierClass: any;
    try {
        BeautifierClass = req(beautifierPath);
    } catch (e) {
        console.error('Failed loading beautifier:', e);
        return null;
    }

    const settings = getConfig(document);
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
    const minifierPath = resolveScriptPath(document, 'formula-minifier.js');
    if (!minifierPath) return null;

    const req = (eval('require')) as (id: string) => any;
    let MinifierClass: any;
    try {
        MinifierClass = req(minifierPath);
    } catch (e) {
        console.error('Failed loading minifier:', e);
        return null;
    }

    const settings = getConfig(document);
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
