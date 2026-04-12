import * as path from 'path';
import * as vscode from 'vscode';
import { getSettings } from '../settings.js';
import { buildServerEntry, buildNpxServerEntry } from '../auto-config/index.js';

export function getBundledServerPath(context: vscode.ExtensionContext): string {
  const override = getSettings().mcp.serverPathOverride;
  if (override) return override;
  return path.join(context.extensionPath, 'dist', 'mcp', 'index.mjs');
}

export function getServerEntry(context: vscode.ExtensionContext): Record<string, unknown> {
  const settings = getSettings();
  if (settings.mcp.serverSource === 'npx') return buildNpxServerEntry();
  return buildServerEntry(getBundledServerPath(context));
}
