import * as path from 'path';
import * as vscode from 'vscode';
import { getSettings } from '../settings.js';

export function getBundledServerPath(context: vscode.ExtensionContext): string {
  const override = getSettings().mcp.serverPathOverride;
  if (override) return override;
  return path.join(context.extensionPath, 'dist', 'mcp', 'index.js');
}
