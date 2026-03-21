import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface BeautifyOptions {
    max_line_length?: number;
    quote_style?: 'single' | 'double';
    indent_size?: number;
    style?: 'ultra-compact' | 'compact' | 'readable' | 'json' | 'cascade' | 'smart';
}

type BeautifyFn = (text: string) => string;
type ConfigTarget = vscode.TextDocument | vscode.Uri;

const BEAUTIFY_STYLES = [
    { label: 'Smart (Adaptive)', value: 'smart', description: 'Adapts formatting based on formula complexity' },
    { label: 'Compact', value: 'compact', description: 'Minimal indentation, balanced readability' },
    { label: 'Readable', value: 'readable', description: 'Human-friendly with clear structure' },
    { label: 'Ultra-Compact', value: 'ultra-compact', description: 'No indentation, maximum compression' },
    { label: 'JSON', value: 'json', description: 'Optimized for JSON string building' },
    { label: 'Cascade', value: 'cascade', description: 'For cascading IF conditions' },
];

const activeFileOperations = new Set<string>();

function resolveScriptPath(target: ConfigTarget, fileName: string, scriptRoot?: string): string | null {
    const uri = target instanceof vscode.Uri ? target : target.uri;
    const extensionPath = vscode.extensions.getExtension('Nskha.airtable-formula')?.extensionPath;
    if (extensionPath) {
        const extCandidates = [
            path.join(extensionPath, 'dist', 'vendor', fileName),
            path.join(extensionPath, 'src', 'vendor', fileName),
        ];
        for (const candidate of extCandidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }

    const distCandidates = [
        path.join(__dirname, 'vendor', fileName),
        path.join(__dirname, '..', 'vendor', fileName),
    ];

    for (const candidate of distCandidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    const srcCandidates = [
        path.join(__dirname, '..', 'src', 'vendor', fileName),
        path.join(__dirname, '..', '..', 'src', 'vendor', fileName),
    ];

    for (const candidate of srcCandidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    const wsFolder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
    const wsPath = wsFolder?.uri.fsPath;

    let root = scriptRoot || (wsPath ? path.join(wsPath, 'draft', 'scripts') : '');
    if (wsPath && root && root.includes('${workspaceFolder}')) {
        root = root.replace('${workspaceFolder}', wsPath);
    }

    if (root) {
        const fullPath = path.join(root, fileName);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }

    if (wsPath) {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const candidate = path.join(folder.uri.fsPath, 'draft', 'scripts', fileName);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}

function getBeautifyFunctionWithStyle(target: ConfigTarget, style: string): BeautifyFn | null {
    const scope = target instanceof vscode.Uri ? target : target.uri;
    const config = vscode.workspace.getConfiguration('airtableFormula', scope);
    const version = config.get<string>('beautifierVersion') || 'v2';
    const scriptRoot = config.get<string>('scriptRoot');
    
    const fileName = version === 'v2' ? 'formula-beautifier-v2.js' : 'formula-beautifier.js';
    const beautifierPath = resolveScriptPath(target, fileName, scriptRoot);
    
    let fallbackPath: string | null = null;
    if (!beautifierPath && version === 'v2') {
        fallbackPath = resolveScriptPath(target, 'formula-beautifier.js', scriptRoot);
    }
    
    const finalPath = beautifierPath || fallbackPath;
    if (!finalPath) {
        return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let BeautifierClass: any;
    try {
        BeautifierClass = require(finalPath);
    } catch (e) {
        console.error('Failed loading beautifier:', e);
        return null;
    }

    const options: BeautifyOptions = {
        max_line_length: config.get<number>('beautify.maxLineLength') ?? 120,
        quote_style: config.get<'single' | 'double'>('beautify.quoteStyle') ?? 'double',
        indent_size: config.get<number>('beautify.indentSize') ?? 1,
        style: style as any,
    };

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

export async function beautifyWithStyle(styleOverride?: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const document = editor.document;
    if (document.languageId !== 'airtable-formula') {
        void vscode.window.showWarningMessage('This command only works with Airtable Formula files');
        return;
    }

    const selected = styleOverride
        ? BEAUTIFY_STYLES.find(style => style.value === styleOverride)
        : await vscode.window.showQuickPick(BEAUTIFY_STYLES, {
            placeHolder: 'Select beautifier style',
            title: 'Beautify Airtable Formula'
        });

    if (!selected) {
        if (styleOverride) {
            void vscode.window.showErrorMessage(`Unknown beautify style: ${styleOverride}`);
        }
        return;
    }

    const selection = editor.selection;
    const targetRange = selection && !selection.isEmpty
        ? new vscode.Range(selection.start, selection.end)
        : new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    const source = document.getText(targetRange);

    const beautify = getBeautifyFunctionWithStyle(document, selected.value);
    if (!beautify) {
        void vscode.window.showErrorMessage('Beautifier not found. Ensure vendor files exist.');
        return;
    }

    try {
        const result = beautify(source);
        if (result !== source) {
            await editor.edit(edit => edit.replace(targetRange, result));
            void vscode.window.showInformationMessage(`Beautified with ${selected.label} style`);
        }
    } catch (e) {
        console.error(e);
        void vscode.window.showErrorMessage(`Beautify failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

export async function beautifyFilesWithStyle(styleOverride: string, uri?: vscode.Uri, uris?: vscode.Uri[]) {
    const selected = BEAUTIFY_STYLES.find(style => style.value === styleOverride);
    if (!selected) {
        void vscode.window.showErrorMessage(`Unknown beautify style: ${styleOverride}`);
        return;
    }

    const targets = (uris && uris.length ? uris : (uri ? [uri] : []))
        .filter(u => path.extname(u.fsPath).toLowerCase() === '.formula');

    if (!targets.length) {
        void vscode.window.showWarningMessage('No .formula files selected');
        return;
    }

    let ok = 0;
    let fail = 0;

    for (const target of targets) {
        const key = target.fsPath.toLowerCase();
        if (activeFileOperations.has(key)) {
            console.warn('Beautify already running for', target.fsPath);
            fail++;
            continue;
        }

        activeFileOperations.add(key);
        try {
            const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === target.fsPath);
            const beautify = getBeautifyFunctionWithStyle(openDoc ?? target, selected.value);
            if (!beautify) {
                throw new Error('Beautifier not found');
            }
            const source = openDoc
                ? openDoc.getText()
                : Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8');
            const result = beautify(source);
            if (result !== source) {
                if (openDoc) {
                    const fullRange = new vscode.Range(openDoc.positionAt(0), openDoc.positionAt(source.length));
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(openDoc.uri, fullRange, result);
                    await vscode.workspace.applyEdit(edit);
                    await openDoc.save();
                } else {
                    await vscode.workspace.fs.writeFile(target, Buffer.from(result, 'utf8'));
                }
                ok++;
            }
        } catch (e) {
            console.error('Beautify file failed for', target.fsPath, e);
            fail++;
        } finally {
            activeFileOperations.delete(key);
        }
    }

    void vscode.window.showInformationMessage(`Beautified ${ok} file(s) with ${selected.label}` + (fail ? `, ${fail} failed` : ''));
}
