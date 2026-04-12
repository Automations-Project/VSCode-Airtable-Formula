import * as vscode from 'vscode';
import type { DebugCollector } from './collector.js';

export function tracedCommand(
  collector: DebugCollector,
  commandId: string,
  callback: (...args: unknown[]) => unknown,
): vscode.Disposable {
  return vscode.commands.registerCommand(commandId, async (...args: unknown[]) => {
    collector.trace('ext', 'command', 'command:execute', { command_id: commandId });
    try {
      const result = await callback(...args);
      return result;
    } catch (err) {
      collector.trace(
        'ext', 'error', 'error:unhandled',
        { context: `command:${commandId}` },
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  });
}

export function traceWebviewMessages(
  collector: DebugCollector,
  webview: vscode.Webview,
): vscode.Disposable {
  return webview.onDidReceiveMessage((msg: { type?: string }) => {
    collector.trace('ext', 'webview', 'webview:message_in', {
      type: msg?.type ?? 'unknown',
    });
  });
}

export function createTracedPostMessage(
  collector: DebugCollector,
  webview: vscode.Webview,
): (message: unknown) => Thenable<boolean> {
  return (message: unknown) => {
    const type = (message as { type?: string })?.type ?? 'unknown';
    collector.trace('ext', 'webview', 'webview:message_out', { type });
    return webview.postMessage(message);
  };
}

export function traceConfigChanges(collector: DebugCollector): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('airtableFormula')) {
      collector.trace('ext', 'config', 'config:settings_change', {
        section: 'airtableFormula',
      });
    }
  });
}
