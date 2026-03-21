import * as vscode from 'vscode';

const NS = 'airtableFormula';

export interface Settings {
  mcp: { autoConfigureOnInstall: boolean; serverPathOverride: string; notifyOnUpdates: boolean };
  ai:  { autoInstallFiles: boolean; includeAgents: boolean };
  formula: { formatterVersion: 'v1' | 'v2'; defaultBeautifyStyle: string };
}

export function getSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration(NS);
  return {
    mcp: {
      autoConfigureOnInstall: cfg.get('mcp.autoConfigureOnInstall', true),
      serverPathOverride:     cfg.get('mcp.serverPathOverride', ''),
      notifyOnUpdates:        cfg.get('mcp.notifyOnUpdates', true),
    },
    ai: {
      autoInstallFiles: cfg.get('ai.autoInstallFiles', true),
      includeAgents:    cfg.get('ai.includeAgents', false),
    },
    formula: {
      formatterVersion:      cfg.get('formula.formatterVersion', 'v2') as 'v1' | 'v2',
      defaultBeautifyStyle:  cfg.get('formula.defaultBeautifyStyle', 'readable'),
    },
  };
}

export async function updateSetting(key: string, value: unknown): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(NS);
  await cfg.update(key, value, vscode.ConfigurationTarget.Global);
}
