import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface MinifyOptions {
    level?: 'micro' | 'safe' | 'standard' | 'aggressive' | 'extreme';
    preserve_readability?: boolean;
}

type MinifyFn = (text: string) => string;
type ConfigTarget = vscode.TextDocument | vscode.Uri;

const MINIFY_LEVELS = [
    { label: 'Standard', value: 'standard', description: 'Balanced optimization' },
    { label: 'Safe', value: 'safe', description: 'Prevents tokenization issues with line breaks' },
    { label: 'Aggressive', value: 'aggressive', description: 'More aggressive space removal' },
    { label: 'Extreme', value: 'extreme', description: 'Maximum compression' },
    { label: 'Micro', value: 'micro', description: 'Minimal changes, preserves most formatting' },
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

function getMinifyFunctionWithLevel(target: ConfigTarget, level: string): MinifyFn | null {
    const scope = target instanceof vscode.Uri ? target : target.uri;
    const config = vscode.workspace.getConfiguration('airtableFormula', scope);
    const version = config.get<string>('formula.formatterVersion')
        ?? config.get<string>('minifierVersion')
        ?? 'v2';
    const scriptRoot = config.get<string>('scriptRoot');
    
    const fileName = version === 'v2' ? 'formula-minifier-v2.js' : 'formula-minifier.js';
    const minifierPath = resolveScriptPath(target, fileName, scriptRoot);
    
    let fallbackPath: string | null = null;
    if (!minifierPath && version === 'v2') {
        fallbackPath = resolveScriptPath(target, 'formula-minifier.js', scriptRoot);
    }
    
    const finalPath = minifierPath || fallbackPath;
    if (!finalPath) {
        return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let MinifierClass: any;
    try {
        MinifierClass = require(finalPath);
    } catch (e) {
        console.error('Failed loading minifier:', e);
        return null;
    }

    const options: MinifyOptions = {
        level: level as any,
        preserve_readability: config.get<boolean>('minify.preserveReadability') ?? false,
    };

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

export async function minifyWithLevel(levelOverride?: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const document = editor.document;
    if (document.languageId !== 'airtable-formula') {
        void vscode.window.showWarningMessage('This command only works with Airtable Formula files');
        return;
    }

    const selected = levelOverride
        ? MINIFY_LEVELS.find(level => level.value === levelOverride)
        : await vscode.window.showQuickPick(MINIFY_LEVELS, {
            placeHolder: 'Select minification level',
            title: 'Minify Airtable Formula'
        });

    if (!selected) {
        if (levelOverride) {
            void vscode.window.showErrorMessage(`Unknown minify level: ${levelOverride}`);
        }
        return;
    }

    const selection = editor.selection;
    const targetRange = selection && !selection.isEmpty
        ? new vscode.Range(selection.start, selection.end)
        : new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    const source = document.getText(targetRange);

    const minify = getMinifyFunctionWithLevel(document, selected.value);
    if (!minify) {
        void vscode.window.showErrorMessage('Minifier not found. Ensure vendor files exist.');
        return;
    }

    try {
        const result = minify(source);
        if (result !== source) {
            await editor.edit(edit => edit.replace(targetRange, result));
            void vscode.window.showInformationMessage(`Minified with ${selected.label} level`);
        }
    } catch (e) {
        console.error(e);
        void vscode.window.showErrorMessage(`Minify failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

export async function minifyFilesWithLevel(levelOverride: string, uri?: vscode.Uri, uris?: vscode.Uri[]) {
    const selected = MINIFY_LEVELS.find(level => level.value === levelOverride);
    if (!selected) {
        void vscode.window.showErrorMessage(`Unknown minify level: ${levelOverride}`);
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
            console.warn('Minify already running for', target.fsPath);
            fail++;
            continue;
        }

        activeFileOperations.add(key);
        try {
            const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === target.fsPath);
            const minify = getMinifyFunctionWithLevel(openDoc ?? target, selected.value);
            if (!minify) {
                throw new Error('Minifier not found');
            }
            const source = openDoc
                ? openDoc.getText()
                : Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8');
            const result = minify(source);
            if (result !== source) {
                const outputExt = selected.value === 'extreme' ? '.ultra-min.formula' : '.min.formula';
                const isMinifiedTarget = /\.(ultra-)?min\.formula$/i.test(target.fsPath);
                const outPath = isMinifiedTarget
                    ? target.fsPath
                    : target.fsPath.replace(/\.formula$/i, outputExt);
                const outUri = isMinifiedTarget ? target : vscode.Uri.file(outPath);

                if (isMinifiedTarget && openDoc) {
                    const fullRange = new vscode.Range(openDoc.positionAt(0), openDoc.positionAt(source.length));
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(openDoc.uri, fullRange, result);
                    await vscode.workspace.applyEdit(edit);
                    await openDoc.save();
                } else {
                    await vscode.workspace.fs.writeFile(outUri, Buffer.from(result, 'utf8'));
                }
                ok++;
            }
        } catch (e) {
            console.error('Minify file failed for', target.fsPath, e);
            fail++;
        } finally {
            activeFileOperations.delete(key);
        }
    }

    void vscode.window.showInformationMessage(`Minified ${ok} file(s) with ${selected.label}` + (fail ? `, ${fail} failed` : ''));
}
