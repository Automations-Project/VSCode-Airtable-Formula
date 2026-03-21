import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AirtableFormulaDiagnosticsProvider } from './diagnostics';
import { AirtableFormulaCompletionProvider } from './completions';
import { AirtableFormulaHoverProvider } from './hover';
import { AirtableFormulaSignatureHelpProvider } from './signature';
import { AirtableFormulaCodeActionProvider } from './codeActions';
import { registerSkillCommands, installSkills } from './skills/skillInstaller';
import { DashboardProvider } from './webview/DashboardProvider.js';
import { registerMcpProvider } from './mcp/registration.js';
import { getSettings, updateSetting } from './settings.js';
import { getAllIdeStatuses, configureMcpForIde } from './auto-config/index.js';
import { installAiFiles } from './skills/installer.js';
import { getBundledServerPath } from './mcp/server-path.js';

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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const manualTestLogPath = process.env.AIRTABLE_FORMULA_MANUAL_TEST_LOG;
    const manualTestWrite = (level: 'log' | 'warn' | 'error', ...args: unknown[]) => {
        if (!manualTestLogPath) {
            return;
        }
        try {
            const ts = new Date().toISOString();
            const msg = args.map((a) => {
                if (a instanceof Error) {
                    return a.stack || a.message;
                }
                if (typeof a === 'string') {
                    return a;
                }
                try {
                    return JSON.stringify(a);
                } catch {
                    return String(a);
                }
            }).join(' ');
            fs.appendFileSync(manualTestLogPath, `[${ts}] [${level}] ${msg}\n`, 'utf8');
        } catch {
        }
    };

    if (manualTestLogPath) {
        const originalLog = console.log.bind(console);
        const originalWarn = console.warn.bind(console);
        const originalError = console.error.bind(console);

        console.log = (...args: unknown[]) => {
            manualTestWrite('log', ...args);
            originalLog(...args);
        };
        console.warn = (...args: unknown[]) => {
            manualTestWrite('warn', ...args);
            originalWarn(...args);
        };
        console.error = (...args: unknown[]) => {
            manualTestWrite('error', ...args);
            originalError(...args);
        };
    }

    console.log('Extension "airtable-formula" activated');

    // ── Formula features (existing, unchanged) ──────────────────────────

    // Register AI skill commands and auto-install skills
    registerSkillCommands(context);
    installSkills(false); // Only install if not already present

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

    // Register hover provider
    const hoverProvider = vscode.languages.registerHoverProvider(
        'airtable-formula',
        new AirtableFormulaHoverProvider()
    );
    context.subscriptions.push(hoverProvider);

    // Register signature help provider
    const signatureHelpProvider = vscode.languages.registerSignatureHelpProvider(
        'airtable-formula',
        new AirtableFormulaSignatureHelpProvider(),
        '(', ','
    );
    context.subscriptions.push(signatureHelpProvider);

    // Register code actions provider
    const codeActionsProvider = vscode.languages.registerCodeActionsProvider(
        'airtable-formula',
        new AirtableFormulaCodeActionProvider(),
        { providedCodeActionKinds: AirtableFormulaCodeActionProvider.providedCodeActionKinds }
    );
    context.subscriptions.push(codeActionsProvider);

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
        console.log('Command: airtable-formula.beautify');
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
        console.log('Command: airtable-formula.minify');
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
        const { beautifyFilesWithStyle } = await import('./commands/beautifyWithStyle.js');
        const style = vscode.workspace.getConfiguration('airtableFormula', targets[0]).get<string>('beautify.style') ?? 'compact';
        await beautifyFilesWithStyle(style, uri, uris);
    });

    // Explorer context: Minify file(s) to new .min.formula (or .ultra-min.formula for extreme)
    const minifyFileCmd = vscode.commands.registerCommand('airtable-formula.minifyFile', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const targets = (uris && uris.length ? uris : (uri ? [uri] : [])).filter(u => path.extname(u.fsPath).toLowerCase() === '.formula');
        if (!targets.length) {
            void vscode.window.showWarningMessage('No .formula files selected');
            return;
        }
        const { minifyFilesWithLevel } = await import('./commands/minifyWithLevel.js');
        const level = vscode.workspace.getConfiguration('airtableFormula', targets[0]).get<string>('minify.level') ?? 'standard';
        await minifyFilesWithLevel(level, uri, uris);
    });

    // Command: Beautify with style selection
    const beautifyWithStyleCmd = vscode.commands.registerCommand('airtable-formula.beautifyWithStyle', async () => {
        const { beautifyWithStyle } = await import('./commands/beautifyWithStyle.js');
        await beautifyWithStyle();
    });

    // Command: Minify with level selection
    const minifyWithLevelCmd = vscode.commands.registerCommand('airtable-formula.minifyWithLevel', async () => {
        const { minifyWithLevel } = await import('./commands/minifyWithLevel.js');
        await minifyWithLevel();
    });

    const beautifyStyleCommands = [
        { id: 'airtable-formula.beautifyStyle.smart', style: 'smart' },
        { id: 'airtable-formula.beautifyStyle.compact', style: 'compact' },
        { id: 'airtable-formula.beautifyStyle.readable', style: 'readable' },
        { id: 'airtable-formula.beautifyStyle.ultra-compact', style: 'ultra-compact' },
        { id: 'airtable-formula.beautifyStyle.json', style: 'json' },
        { id: 'airtable-formula.beautifyStyle.cascade', style: 'cascade' },
    ];

    const minifyLevelCommands = [
        { id: 'airtable-formula.minifyLevel.standard', level: 'standard' },
        { id: 'airtable-formula.minifyLevel.safe', level: 'safe' },
        { id: 'airtable-formula.minifyLevel.aggressive', level: 'aggressive' },
        { id: 'airtable-formula.minifyLevel.extreme', level: 'extreme' },
        { id: 'airtable-formula.minifyLevel.micro', level: 'micro' },
    ];

    const beautifyStyleCmds = beautifyStyleCommands.map(({ id, style }) =>
        vscode.commands.registerCommand(id, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            const { beautifyWithStyle, beautifyFilesWithStyle } = await import('./commands/beautifyWithStyle.js');
            if (uri || (uris && uris.length)) {
                await beautifyFilesWithStyle(style, uri, uris);
                return;
            }
            await beautifyWithStyle(style);
        })
    );

    const minifyLevelCmds = minifyLevelCommands.map(({ id, level }) =>
        vscode.commands.registerCommand(id, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
            const { minifyWithLevel, minifyFilesWithLevel } = await import('./commands/minifyWithLevel.js');
            if (uri || (uris && uris.length)) {
                await minifyFilesWithLevel(level, uri, uris);
                return;
            }
            await minifyWithLevel(level);
        })
    );

    // Command: Format with preset (new unified system)
    const formatWithPresetCmd = vscode.commands.registerCommand('airtable-formula.formatWithPreset', async () => {
        const { formatWithPreset } = await import('./commands/formatWithPreset.js');
        await formatWithPreset();
    });

    context.subscriptions.push(
        formatter,
        beautifyCmd,
        minifyCmd,
        beautifyFileCmd,
        minifyFileCmd,
        beautifyWithStyleCmd,
        minifyWithLevelCmd,
        formatWithPresetCmd,
        ...beautifyStyleCmds,
        ...minifyLevelCmds
    );

    // ── Dashboard webview ────────────────────────────────────────────────
    const dashboardProvider = new DashboardProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DashboardProvider.viewId, dashboardProvider)
    );

    // ── Dashboard & MCP commands ─────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('airtable-formula.openDashboard', () => {
            vscode.commands.executeCommand('airtable-formula.dashboard.focus');
        }),
        vscode.commands.registerCommand('airtable-formula.refreshStatus', () => {
            dashboardProvider.refresh();
        }),
        vscode.commands.registerCommand('airtable-formula.setupAll', async () => {
            const settings = getSettings();
            const serverPath = getBundledServerPath(context);
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
            const statuses = await getAllIdeStatuses();
            await Promise.all(
                statuses.filter(s => s.detected).map(s =>
                    configureMcpForIde(s.ideId, serverPath)
                        .then(() => installAiFiles(s.ideId, workspaceRoot, false, settings.ai.includeAgents))
                )
            );
            dashboardProvider.refresh();
            vscode.window.showInformationMessage('Airtable Formula: All IDEs configured.');
        }),
        vscode.commands.registerCommand('airtable-formula.installAISkills', async () => {
            const s = getSettings();
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
            const statuses = await getAllIdeStatuses();
            await Promise.all(statuses.filter(st => st.detected).map(st =>
                installAiFiles(st.ideId, workspaceRoot, true, s.ai.includeAgents)
            ));
            dashboardProvider.refresh();
            vscode.window.showInformationMessage('Airtable Formula: AI files installed.');
        })
    );

    // ── Native MCP registration ──────────────────────────────────────────
    const mcpChanged = new vscode.EventEmitter<void>();
    context.subscriptions.push(mcpChanged);
    registerMcpProvider(context, mcpChanged);

    // ── First-launch auto-setup ──────────────────────────────────────────
    const settings = getSettings();
    const firstLaunch = !context.globalState.get<boolean>('airtable-formula.initialized');
    if (firstLaunch) {
        await context.globalState.update('airtable-formula.initialized', true);
        if (settings.mcp.autoConfigureOnInstall) {
            const serverPath = getBundledServerPath(context);
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
            const statuses = await getAllIdeStatuses();
            const detectedReady = statuses.filter(s => s.detected && !s.mcpConfigured);
            if (detectedReady.length > 0) {
                await Promise.all(detectedReady.map(s => configureMcpForIde(s.ideId, serverPath)));
                vscode.window.showInformationMessage(`Airtable Formula: MCP configured for ${detectedReady.map(s => s.label).join(', ')}.`);
            }
        }
        if (settings.ai.autoInstallFiles) {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
            const statuses = await getAllIdeStatuses();
            await Promise.all(statuses.filter(s => s.detected).map(s => installAiFiles(s.ideId, workspaceRoot)));
        }
    }
}

export function deactivate(): void {}

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

    // Use Node.js require for dynamic loading of vendor scripts
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let BeautifierClass: any;
    try {
        // Dynamic require - vendor files are copied to dist/vendor at build time
        BeautifierClass = require(finalPath);
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

    // Use Node.js require for dynamic loading of vendor scripts
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let MinifierClass: any;
    try {
        // Dynamic require - vendor files are copied to dist/vendor at build time
        MinifierClass = require(finalPath);
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
