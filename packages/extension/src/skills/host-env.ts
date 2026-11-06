import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { detectInstalledIdes } from '../auto-config/ide-detection.js';
import type { SkillEnv } from './installer.js';

/** The installer's view of this host: home, workspace, extension version and detected IDEs. */
export async function skillEnv(context: vscode.ExtensionContext): Promise<SkillEnv> {
  return {
    home: os.homedir(),
    // Restricted Mode: no workspace root, so a project-scope install never writes into an untrusted repository.
    workspaceRoot: vscode.workspace.isTrusted ? (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null) : null,
    version: context.extension.packageJSON.version,
    skillSourceDir: path.join(context.extensionPath, 'dist', 'skills', 'airtable-formula'),
    detectedIdes: await detectInstalledIdes(),
    xdgConfigHome: process.env.XDG_CONFIG_HOME,
  };
}
