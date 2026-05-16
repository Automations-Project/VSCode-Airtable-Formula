import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { DaemonManager } from '../mcp/daemon-manager.js';
import {
  parseFormulaHeader,
  stripFormulaHeader,
} from '../language/formula/formula-header.js';

// ---------------------------------------------------------------------------
// Internal helper — JSON-RPC 2.0 tools/call against the daemon MCP endpoint
// ---------------------------------------------------------------------------

async function callDaemonTool(
  daemonManager: DaemonManager,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const conn = await daemonManager.ensureDaemon({ timeoutMs: 15_000 });
  const { port, bearerToken } = conn;

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });

  let raw: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearerToken}`,
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`Daemon returned HTTP ${response.status}: ${await response.text()}`);
    }
    raw = await response.text();
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new Error(`Daemon call to ${toolName} timed out after 30s`);
    }
    throw err;
  }

  const envelope = JSON.parse(raw) as {
    result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    error?: { message: string };
  };

  if (envelope.error) {
    throw new Error(`MCP error from ${toolName}: ${envelope.error.message}`);
  }

  const content = envelope.result?.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error(`Unexpected empty response from ${toolName}`);
  }

  const textBlock = content.find(c => c.type === 'text' && typeof c.text === 'string');
  const textContent = textBlock?.text ?? '{}';

  if ((envelope.result as { isError?: boolean })?.isError) {
    const errObj = JSON.parse(textContent) as { error?: string };
    throw new Error(errObj.error ?? textContent);
  }

  if (!textBlock?.text) {
    throw new Error(`No text block in response from ${toolName}`);
  }

  return JSON.parse(textContent) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Upload: read .formula file → push to Airtable via update_formula_field
// ---------------------------------------------------------------------------

export async function uploadFormulaFile(
  uri: vscode.Uri,
  daemonManager: DaemonManager,
): Promise<void> {
  const raw = await fs.readFile(uri.fsPath, 'utf8');
  const meta = parseFormulaHeader(raw, 'formula');

  if (!meta['appId'] || !meta['fieldId']) {
    vscode.window.showErrorMessage(
      'No Airtable target found. Add a `# AT: appId=... fieldId=...` header at the top of the file, or use "Airtable: Download Formula Field" to create a properly-linked file.',
    );
    return;
  }

  const formulaText = stripFormulaHeader(raw, 'formula').formula;

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Uploading formula to Airtable…',
        cancellable: false,
      },
      async () => {
        await callDaemonTool(daemonManager, 'update_formula_field', {
          appId: meta['appId'],
          fieldId: meta['fieldId'],
          formulaText,
        });
      },
    );
    vscode.window.showInformationMessage(`Formula uploaded (fieldId: ${meta['fieldId']})`);
  } catch (err) {
    vscode.window.showErrorMessage(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Download: prompt for IDs → fetch from Airtable → write .formula file
// ---------------------------------------------------------------------------

export async function downloadFormulaField(
  daemonManager: DaemonManager,
): Promise<void> {
  const appId = await vscode.window.showInputBox({
    prompt: 'Airtable Base ID',
    placeHolder: 'appXXXXXXXXXXXXXX',
    validateInput: v => (v?.startsWith('app') ? null : 'Must start with "app"'),
  });
  if (!appId) return;

  const fieldId = await vscode.window.showInputBox({
    prompt: 'Formula Field ID',
    placeHolder: 'fldXXXXXXXXXXXXXX',
    validateInput: v => (v?.startsWith('fld') ? null : 'Must start with "fld"'),
  });
  if (!fieldId) return;

  let result: { formulaText: string; fieldName: string; tableId: string } | undefined;

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Downloading formula from Airtable…',
        cancellable: false,
      },
      async () => {
        result = (await callDaemonTool(daemonManager, 'download_formula_field', {
          appId,
          fieldId,
        })) as { formulaText: string; fieldName: string; tableId: string };
      },
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!result) return;

  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Save formula here',
  });
  if (!folders || folders.length === 0) return;

  const safeName = result.fieldName.replace(/[/\\:*?"<>|]/g, '_');
  const filePath = path.join(folders[0].fsPath, `${safeName}.formula`);
  const header = `# AT: appId=${appId} tableId=${result.tableId} fieldId=${fieldId} fieldName="${result.fieldName}"\n`;
  await fs.writeFile(filePath, header + result.formulaText, 'utf8');

  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);
  vscode.window.showInformationMessage(`Formula saved to ${path.basename(filePath)}`);
}
