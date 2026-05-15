import * as vscode from 'vscode';
import type { DebugCollector } from './collector.js';

export function traceConfigChanges(collector: DebugCollector): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('airtableFormula')) {
      collector.trace('ext', 'config', 'config:settings_change', {
        section: 'airtableFormula',
      });
    }
  });
}
