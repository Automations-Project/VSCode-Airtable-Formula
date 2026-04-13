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
import { AuthManager } from './mcp/auth-manager.js';
import { BrowserDownloadManager } from './mcp/browser-download.js';
import { ToolProfileManager, BUILTIN_PROFILES, CATEGORY_LABELS, TOOL_CATEGORIES } from './mcp/tool-profile.js';

// Inlined to avoid pulling shared/ESM types into the CJS extension DTS build.
// These must mirror the ToolProfileName / ToolCategories definitions in
// packages/shared/src/types.ts.
type LocalToolProfileName = 'read-only' | 'safe-write' | 'full' | 'custom';
type LocalToolCategoryKey = 'read' | 'fieldWrite' | 'fieldDestructive' | 'viewWrite' | 'viewDestructive' | 'extension';
import { getSettings, updateSetting } from './settings.js';
import { getAllIdeStatuses, configureMcpForIde, ensureLauncher } from './auto-config/index.js';
import { installAiFiles } from './skills/installer.js';
import { getBundledServerPath, getServerEntry } from './mcp/server-path.js';
import { DebugCollector, exportDebugLog, traceConfigChanges } from './debug/index.js';

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

    // ── Stable MCP launcher (version-independent path) ────────────────
    // Write/update ~/.airtable-user-mcp/start.mjs + bundled-path.json so
    // external IDEs always resolve the current extension's bundled server.
    await ensureLauncher(getBundledServerPath(context));

    // ── Debug trace system ──────────────────────────────────────────
    const debugSettings = getSettings().debug;
    const debugCollector = new DebugCollector(getSettings().debug.bufferSize, debugSettings.enabled);

    // Live-stream debug events to the VS Code Output panel
    const debugOutput = vscode.window.createOutputChannel('Airtable Formula: Debug Log');
    context.subscriptions.push(debugOutput);
    debugCollector.onEvent = (ev) => {
        const time = ev.ts.slice(11, 23); // HH:MM:SS.mmm
        const tag = `[${ev.source}] ${ev.event}`;
        const data = Object.keys(ev.data).length > 0 ? ' ' + JSON.stringify(ev.data) : '';
        const err = ev.error ? ` ERROR: ${ev.error}` : '';
        debugOutput.appendLine(`${time} ${tag}${data}${err}`);
    };

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

    // ── Auth Manager + Browser Download Manager ──────────────────────────
    const authManager = new AuthManager(context.secrets, context.extensionPath);
    const browserDownloadManager = new BrowserDownloadManager(context, context.extensionPath);
    authManager.attachDownloadManager(browserDownloadManager);
    authManager.setDebugCollector(debugCollector);

    // ── Tool Profile Manager (merged from legacy mcp-airtable-tool-manager) ──
    const toolProfileManager = new ToolProfileManager();
    context.subscriptions.push(authManager, browserDownloadManager, toolProfileManager);

    // ── Dashboard webview ────────────────────────────────────────────────
    const dashboardProvider = new DashboardProvider(context);
    dashboardProvider.setAuthManager(authManager);
    dashboardProvider.setDebugCollector(debugCollector);
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

    // ── Auth commands ────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('airtable-formula.login', async () => {
            const hasCreds = await authManager.hasCredentials();
            if (!hasCreds) {
                vscode.window.showWarningMessage('Airtable Formula: No credentials stored. Open Settings tab in the dashboard to save your Airtable credentials.');
                return;
            }
            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Airtable Formula: Logging in...', cancellable: false },
                async () => {
                    debugCollector.trace('ext', 'auth', 'auth:login_start', { method: 'programmatic' });
                    const state = await authManager.login();
                    debugCollector.trace('ext', 'auth', 'auth:login_result', {
                        success: state.status === 'valid',
                    }, state.status !== 'valid' ? state.error : undefined);
                    if (state.status === 'valid') {
                        vscode.window.showInformationMessage(`Airtable Formula: Logged in successfully (${state.userId || 'unknown user'}).`);
                    } else {
                        vscode.window.showErrorMessage(`Airtable Formula: Login failed — ${state.error || 'unknown error'}.`);
                    }
                    dashboardProvider.refresh();
                }
            );
        }),
        vscode.commands.registerCommand('airtable-formula.logout', async () => {
            await authManager.clearCredentials();
            vscode.window.showInformationMessage('Airtable Formula: Credentials cleared.');
            dashboardProvider.refresh();
        }),
        vscode.commands.registerCommand('airtable-formula.status', async () => {
            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Airtable Formula: Checking session...', cancellable: false },
                async () => {
                    const state = await authManager.checkSession();
                    if (state.status === 'valid') {
                        vscode.window.showInformationMessage('Airtable Formula: Session is active.');
                    } else {
                        vscode.window.showWarningMessage(`Airtable Formula: Session ${state.status} — ${state.error || 'check Settings tab'}.`);
                    }
                    dashboardProvider.refresh();
                }
            );
        }),
        vscode.commands.registerCommand('airtable-formula.switchToolProfile', async () => {
            const items: Array<vscode.QuickPickItem & { value: LocalToolProfileName }> = [
                { label: '$(eye) read-only',   description: BUILTIN_PROFILES['read-only'].description, value: 'read-only' },
                { label: '$(edit) safe-write', description: BUILTIN_PROFILES['safe-write'].description, value: 'safe-write' },
                { label: '$(unlock) full',     description: BUILTIN_PROFILES.full.description,          value: 'full' },
                { label: '$(gear) custom',     description: 'User-defined per-tool selection',          value: 'custom' },
            ];
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select an MCP tool profile',
                title: 'Airtable Formula: Switch MCP Tool Profile',
            });
            if (!picked) return;
            await toolProfileManager.setProfile(picked.value);
            const snapshot = toolProfileManager.getSnapshot();
            vscode.window.showInformationMessage(`Airtable Formula: MCP profile "${snapshot.profile}" active — ${snapshot.enabledCount}/${snapshot.totalCount} tools enabled.`);
            dashboardProvider.refresh();
        }),
        vscode.commands.registerCommand('airtable-formula.toggleToolCategory', async () => {
            const settingsCategoryKeys: LocalToolCategoryKey[] = [
                'read', 'fieldWrite', 'fieldDestructive', 'viewWrite', 'viewDestructive', 'extension'
            ];
            // Map settings-side key → on-disk (file-format) category key
            const fileKeyBySettingsKey: Record<LocalToolCategoryKey, string> = {
                read:             'read',
                fieldWrite:       'fieldWrite',
                fieldDestructive: 'field-destructive',
                viewWrite:        'viewWrite',
                viewDestructive:  'view-destructive',
                extension:        'extension',
            };
            const snapshot = toolProfileManager.getSnapshot();
            const items = settingsCategoryKeys.map(key => {
                const fileKey = fileKeyBySettingsKey[key];
                const toolCount = Object.values(TOOL_CATEGORIES).filter(c => c === fileKey).length;
                return {
                    label: `${snapshot.categories[key] ? '$(check)' : '$(circle-slash)'} ${CATEGORY_LABELS[fileKey] ?? key}`,
                    description: `${toolCount} tool${toolCount === 1 ? '' : 's'}`,
                    picked: snapshot.categories[key],
                    value: key,
                };
            });
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select categories to enable (unchecked = disabled)',
                title: 'Airtable Formula: Toggle MCP Tool Categories',
                canPickMany: true,
            });
            if (!picked) return;
            const pickedSet = new Set(picked.map(p => p.value));
            // Switch to custom and write each category
            await toolProfileManager.setProfile('custom');
            for (const key of settingsCategoryKeys) {
                await toolProfileManager.toggleCategory(key, pickedSet.has(key));
            }
            const after = toolProfileManager.getSnapshot();
            vscode.window.showInformationMessage(`Airtable Formula: custom profile — ${after.enabledCount}/${after.totalCount} tools enabled.`);
            dashboardProvider.refresh();
        }),
        vscode.commands.registerCommand('airtable-formula.showToolStatus', async () => {
            const channel = vscode.window.createOutputChannel('Airtable Formula: MCP Tools', 'markdown');
            channel.clear();
            channel.appendLine(toolProfileManager.renderStatusReport());
            channel.show();
        }),
        vscode.commands.registerCommand('airtable-formula.openToolConfig', async () => {
            await toolProfileManager.openConfigFile();
        }),
        vscode.commands.registerCommand('airtable-formula.install-browser', async () => {
            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Airtable Formula: Downloading bundled Chromium...', cancellable: false },
                async (progress) => {
                    const listener = browserDownloadManager.onDidChange(state => {
                        if (state.status === 'downloading' && typeof state.progress === 'number') {
                            progress.report({ message: `${state.progress}%`, increment: undefined });
                        }
                    });
                    try {
                        const state = await browserDownloadManager.download();
                        if (state.status === 'done') {
                            vscode.window.showInformationMessage('Airtable Formula: Bundled Chromium installed.');
                        } else {
                            vscode.window.showErrorMessage(`Airtable Formula: Download failed — ${state.error || 'unknown error'}`);
                        }
                    } finally {
                        listener.dispose();
                        dashboardProvider.refresh();
                    }
                }
            );
        }),
    );

    // ── Debug commands ──────────────────────────────────────────────
    let debugStatusBar: vscode.StatusBarItem | undefined;

    context.subscriptions.push(
        vscode.commands.registerCommand('airtable-formula.debug.startSession', () => {
            if (debugCollector.isSessionActive) {
                vscode.window.showWarningMessage('Debug session already active.');
                return;
            }
            debugCollector.startSession();
            debugStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
            debugStatusBar.text = '$(debug) Debug Session';
            debugStatusBar.tooltip = 'Airtable Formula: Debug session active — click to stop & export';
            debugStatusBar.command = 'airtable-formula.debug.stopAndExport';
            debugStatusBar.show();
            vscode.window.showInformationMessage('Debug session started. Reproduce the issue, then run "Stop & Export Debug Log".');
        }),
        vscode.commands.registerCommand('airtable-formula.debug.stopAndExport', async () => {
            const session = debugCollector.stopSession();
            if (debugStatusBar) {
                debugStatusBar.dispose();
                debugStatusBar = undefined;
            }
            const extVersion = String((context.extension.packageJSON as { version?: string }).version ?? '0.0.0');
            const uri = await exportDebugLog(debugCollector, session, extVersion, getSettings().debug.bufferSize);
            if (uri) {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
                vscode.window.showInformationMessage(`Debug log exported to ${uri.fsPath}`);
            }
        }),
        vscode.commands.registerCommand('airtable-formula.debug.export', async () => {
            const extVersion = String((context.extension.packageJSON as { version?: string }).version ?? '0.0.0');
            const uri = await exportDebugLog(debugCollector, null, extVersion, getSettings().debug.bufferSize);
            if (uri) {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
                vscode.window.showInformationMessage(`Debug log exported to ${uri.fsPath}`);
            }
        }),
    );

    // React to setting changes at runtime
    context.subscriptions.push(
        traceConfigChanges(debugCollector),
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('airtableFormula.debug.enabled')) {
                debugCollector.enabled = getSettings().debug.enabled;
            }
            if (e.affectsConfiguration('airtableFormula.debug.bufferSize')) {
                debugCollector.resize(getSettings().debug.bufferSize);
            }

            // Auto-propagate serverSource changes to all configured IDEs
            if (e.affectsConfiguration('airtableFormula.mcp.serverSource')) {
                const statuses = await getAllIdeStatuses();
                const configured = statuses.filter(s => s.detected && s.mcpConfigured);
                if (configured.length > 0) {
                    const entry = getServerEntry(context);
                    const serverPath = getBundledServerPath(context);
                    await Promise.all(configured.map(s => configureMcpForIde(s.ideId, serverPath, entry)));
                    vscode.window.showInformationMessage(
                        `Airtable Formula: MCP server source updated to "${getSettings().mcp.serverSource}" for ${configured.map(s => s.label).join(', ')}.`
                    );
                    dashboardProvider.refresh();
                }
            }
        }),
    );

    // ── Native MCP registration ──────────────────────────────────────────
    const mcpChanged = new vscode.EventEmitter<void>();
    context.subscriptions.push(mcpChanged);
    registerMcpProvider(context, mcpChanged, authManager);

    // ── Auth init & auto-refresh ─────────────────────────────────────────
    await authManager.init();

    // ── Tool profile sync (VS Code settings ↔ tools-config.json) ─────────
    // IMPORTANT: attach the onDidChange listener BEFORE init() so we catch
    // the final onDidChange fire at the end of init(). Without this, the
    // initial state push to the dashboard misses the fresh tool profile
    // snapshot and the dropdown stays out of sync until the user interacts.
    dashboardProvider.setToolProfileManager(toolProfileManager);
    toolProfileManager.onDidChange(() => dashboardProvider.refresh());
    await toolProfileManager.init();
    // Force a final refresh so the webview gets the post-init state even if
    // the webview wasn't yet resolved when init() fired onDidChange above.
    await dashboardProvider.refresh();

    // ── Auto-heal stale MCP paths on every activation ──────────────────
    {
        const allStatuses = await getAllIdeStatuses();
        const staleIdes = allStatuses.filter(s => s.detected && s.mcpConfigured && s.mcpServerHealthy === false);
        if (staleIdes.length > 0) {
            const entry = getServerEntry(context);
            const serverPath = getBundledServerPath(context);
            await Promise.all(staleIdes.map(s => configureMcpForIde(s.ideId, serverPath, entry)));
            dashboardProvider.refresh();
        }
    }

    // ── First-launch auto-setup ──────────────────────────────────────────
    const settings = getSettings();
    const firstLaunch = !context.globalState.get<boolean>('airtable-formula.initialized');
    if (firstLaunch) {
        await context.globalState.update('airtable-formula.initialized', true);
        if (settings.mcp.autoConfigureOnInstall) {
            const serverPath = getBundledServerPath(context);
            const entry = getServerEntry(context);
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
            const statuses = await getAllIdeStatuses();
            const detectedReady = statuses.filter(s => s.detected && !s.mcpConfigured);
            if (detectedReady.length > 0) {
                await Promise.all(detectedReady.map(s => configureMcpForIde(s.ideId, serverPath, entry)));
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
