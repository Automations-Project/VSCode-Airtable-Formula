import * as vscode from 'vscode';
import * as path from 'path';

const BEAUTIFY_STYLES = [
    { label: 'Default', value: 'default', description: 'Prettier defaults: 2-space indent, double quotes, trailing commas' },
    { label: 'Compact', value: 'compact', description: 'printWidth: 120, no trailing commas' },
    { label: 'Single Quote', value: 'singleQuote', description: 'singleQuote: true' },
    { label: 'Tab Indent', value: 'tabIndent', description: 'useTabs: true' },
    { label: 'Semicolon-free', value: 'semicolonFree', description: 'semi: false' },
];

const MINIFY_LEVELS = [
    { label: 'Safe', value: 'safe', description: 'Whitespace removal only — no mangle, no compress' },
    { label: 'Standard', value: 'standard', description: 'compress: true, mangle: false (good balance)' },
    { label: 'Aggressive', value: 'aggressive', description: 'compress + mangle (best compression, safe for Airtable scripts)' },
    { label: 'Extreme', value: 'extreme', description: 'Aggressive + passes: 2, unsafe compress options' },
];

const SCRIPT_EXTS = new Set(['.ats', '.script', '.ata', '.automation']);
const SCRIPT_LANG_IDS = new Set(['airtable-script', 'airtable-automation']);

const activeFileOperations = new Set<string>();

function getScriptConfig(scope?: vscode.Uri) {
    const cfg = vscode.workspace.getConfiguration('airtableFormula', scope);
    return {
        beautifyStyle: cfg.get<string>('script.beautifyStyle', 'default'),
        minifyLevel:   cfg.get<string>('script.minifyLevel', 'standard'),
        prettier: {
            printWidth:    cfg.get<number>('script.prettier.printWidth', 80),
            tabWidth:      cfg.get<number>('script.prettier.tabWidth', 2),
            useTabs:       cfg.get<boolean>('script.prettier.useTabs', false),
            singleQuote:   cfg.get<boolean>('script.prettier.singleQuote', false),
            semi:          cfg.get<boolean>('script.prettier.semi', true),
            trailingComma: cfg.get<'all' | 'es5' | 'none'>('script.prettier.trailingComma', 'all'),
        },
        terser: {
            mangle: cfg.get<boolean>('script.terser.mangle', true),
        },
    };
}

type ScriptConfig = ReturnType<typeof getScriptConfig>;

function buildPrettierOptions(style: string, cfg: ScriptConfig): Record<string, unknown> {
    const base: Record<string, unknown> = {
        parser:       'babel',
        printWidth:   cfg.prettier.printWidth,
        tabWidth:     cfg.prettier.tabWidth,
        useTabs:      cfg.prettier.useTabs,
        singleQuote:  cfg.prettier.singleQuote,
        semi:         cfg.prettier.semi,
        trailingComma: cfg.prettier.trailingComma,
    };
    switch (style) {
        case 'compact':      return { ...base, printWidth: 120, trailingComma: 'none' };
        case 'singleQuote':  return { ...base, singleQuote: true };
        case 'tabIndent':    return { ...base, useTabs: true };
        case 'semicolonFree': return { ...base, semi: false };
        default:             return base;
    }
}

function buildTerserOptions(level: string, cfg: ScriptConfig): Record<string, unknown> {
    const { mangle } = cfg.terser;
    switch (level) {
        case 'safe':
            return { compress: false, mangle: false, format: { comments: false } };
        case 'standard':
            return { compress: true, mangle: false, format: { comments: false } };
        case 'aggressive':
            return { compress: true, mangle, format: { comments: false } };
        case 'extreme':
            return {
                compress: { passes: 2, unsafe: true, unsafe_arrows: true, unsafe_methods: true, unsafe_proto: true, unsafe_regexp: true },
                mangle,
                format: { comments: false },
            };
        default:
            return { compress: true, mangle: false, format: { comments: false } };
    }
}

async function formatText(text: string, style: string, scope?: vscode.Uri): Promise<string> {
    const cfg = getScriptConfig(scope);
    const options = buildPrettierOptions(style, cfg);
    // prettier v3 is ESM — dynamic import works in both bundled CJS and native ESM contexts
    const prettier = await import('prettier');
    return prettier.format(text, options as Parameters<typeof prettier.format>[1]);
}

async function minifyText(text: string, level: string, scope?: vscode.Uri): Promise<string> {
    const cfg = getScriptConfig(scope);
    const options = buildTerserOptions(level, cfg);
    const { minify } = await import('terser');
    const result = await minify(text, options as Parameters<typeof minify>[1]);
    return result.code ?? text;
}

// ─── Active-editor commands ──────────────────────────────────────────────────

export async function scriptBeautify(styleOverride?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const { document } = editor;
    if (!SCRIPT_LANG_IDS.has(document.languageId)) {
        void vscode.window.showWarningMessage('This command only works with Airtable Script or Automation files');
        return;
    }

    const selected = styleOverride
        ? BEAUTIFY_STYLES.find(s => s.value === styleOverride)
        : await vscode.window.showQuickPick(BEAUTIFY_STYLES, {
            placeHolder: 'Select beautifier style',
            title: 'Beautify Airtable Script/Automation',
        });

    if (!selected) {
        if (styleOverride) void vscode.window.showErrorMessage(`Unknown beautify style: ${styleOverride}`);
        return;
    }

    const sel = editor.selection;
    const targetRange = sel && !sel.isEmpty
        ? new vscode.Range(sel.start, sel.end)
        : new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    const source = document.getText(targetRange);

    try {
        const result = await formatText(source, selected.value, document.uri);
        if (result !== source) {
            await editor.edit(edit => edit.replace(targetRange, result));
            void vscode.window.showInformationMessage(`Beautified with ${selected.label} style`);
        }
    } catch (e) {
        console.error(e);
        void vscode.window.showErrorMessage(`Beautify failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

export async function scriptMinify(levelOverride?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const { document } = editor;
    if (!SCRIPT_LANG_IDS.has(document.languageId)) {
        void vscode.window.showWarningMessage('This command only works with Airtable Script or Automation files');
        return;
    }

    const selected = levelOverride
        ? MINIFY_LEVELS.find(l => l.value === levelOverride)
        : await vscode.window.showQuickPick(MINIFY_LEVELS, {
            placeHolder: 'Select minification level',
            title: 'Minify Airtable Script/Automation',
        });

    if (!selected) {
        if (levelOverride) void vscode.window.showErrorMessage(`Unknown minify level: ${levelOverride}`);
        return;
    }

    const sel = editor.selection;
    const targetRange = sel && !sel.isEmpty
        ? new vscode.Range(sel.start, sel.end)
        : new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    const source = document.getText(targetRange);

    try {
        const result = await minifyText(source, selected.value, document.uri);
        if (result !== source) {
            await editor.edit(edit => edit.replace(targetRange, result));
            void vscode.window.showInformationMessage(`Minified with ${selected.label} level`);
        }
    } catch (e) {
        console.error(e);
        void vscode.window.showErrorMessage(`Minify failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}

// ─── File context-menu commands ───────────────────────────────────────────────

export async function scriptBeautifyFile(uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    const targets = (uris?.length ? uris : uri ? [uri] : [])
        .filter(u => SCRIPT_EXTS.has(path.extname(u.fsPath).toLowerCase()));

    if (!targets.length) {
        void vscode.window.showWarningMessage('No Script/Automation files selected');
        return;
    }

    const style = vscode.workspace.getConfiguration('airtableFormula', targets[0])
        .get<string>('script.beautifyStyle', 'default');
    let ok = 0, fail = 0;

    for (const target of targets) {
        const key = target.fsPath.toLowerCase();
        if (activeFileOperations.has(key)) { fail++; continue; }
        activeFileOperations.add(key);
        try {
            const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === target.fsPath);
            const source = openDoc
                ? openDoc.getText()
                : Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8');
            const result = await formatText(source, style, target);
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

    void vscode.window.showInformationMessage(`Beautified ${ok} file(s)` + (fail ? `, ${fail} failed` : ''));
}

function minifiedPath(fsPath: string): { isAlreadyMin: boolean; outPath: string } {
    const ext = path.extname(fsPath).toLowerCase();
    const base = path.basename(fsPath);
    const isAlreadyMin = /\.min\.(ats|script|ata|automation)$/i.test(base);
    const outPath = isAlreadyMin
        ? fsPath
        : fsPath.slice(0, fsPath.length - ext.length) + `.min${ext}`;
    return { isAlreadyMin, outPath };
}

export async function scriptMinifyFile(uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    const targets = (uris?.length ? uris : uri ? [uri] : [])
        .filter(u => SCRIPT_EXTS.has(path.extname(u.fsPath).toLowerCase()));

    if (!targets.length) {
        void vscode.window.showWarningMessage('No Script/Automation files selected');
        return;
    }

    const level = vscode.workspace.getConfiguration('airtableFormula', targets[0])
        .get<string>('script.minifyLevel', 'standard');
    let ok = 0, fail = 0;

    for (const target of targets) {
        const key = target.fsPath.toLowerCase();
        if (activeFileOperations.has(key)) { fail++; continue; }
        activeFileOperations.add(key);
        try {
            const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === target.fsPath);
            const source = openDoc
                ? openDoc.getText()
                : Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8');
            const result = await minifyText(source, level, target);
            if (result !== source) {
                const { isAlreadyMin, outPath } = minifiedPath(target.fsPath);
                const outUri = isAlreadyMin ? target : vscode.Uri.file(outPath);

                if (isAlreadyMin && openDoc) {
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

    void vscode.window.showInformationMessage(`Minified ${ok} file(s)` + (fail ? `, ${fail} failed` : ''));
}

// ─── DocumentFormattingEditProvider helper ────────────────────────────────────

export async function formatScriptDocument(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
    const cfg = getScriptConfig(document.uri);
    const source = document.getText();
    try {
        const result = await formatText(source, cfg.beautifyStyle, document.uri);
        if (result === source) return [];
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(source.length));
        return [vscode.TextEdit.replace(fullRange, result)];
    } catch (e) {
        console.error(e);
        void vscode.window.showErrorMessage(`Script format failed: ${e instanceof Error ? e.message : String(e)}`);
        return [];
    }
}
