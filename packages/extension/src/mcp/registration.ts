import * as path from 'path';
import * as vscode from 'vscode';
import { MCP_PROVIDER_ID, MCP_SERVER_LABEL } from '../constants.js';
import { getBundledServerPath } from './server-path.js';

type McpCtor = new (...args: unknown[]) => unknown;

function createStdioDefinition(
  label: string, command: string, args: string[],
  env: Record<string, string>, version: string
): unknown {
  const ctor = (vscode as unknown as { McpStdioServerDefinition?: McpCtor }).McpStdioServerDefinition;
  if (!ctor) throw new Error('McpStdioServerDefinition is not available in this VS Code build (requires ^1.100.0)');
  try {
    return new ctor(label, command, args, env, version);
  } catch {
    return new ctor({ label, command, args, env, version });
  }
}

export function registerMcpProvider(
  context: vscode.ExtensionContext,
  onChanged: vscode.EventEmitter<void>
): void {
  const lmApi = (vscode as unknown as {
    lm?: {
      registerMcpServerDefinitionProvider?: (
        id: string,
        provider: {
          onDidChangeMcpServerDefinitions?: vscode.Event<void>;
          provideMcpServerDefinitions: () => Promise<unknown[]>;
        }
      ) => vscode.Disposable;
    };
  }).lm;

  if (typeof lmApi?.registerMcpServerDefinitionProvider !== 'function') {
    return;
  }

  const version = String((context.extension.packageJSON as { version?: string }).version ?? '2.0.0');

  context.subscriptions.push(
    lmApi.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: onChanged.event,
      provideMcpServerDefinitions: async () => {
        try {
          const serverPath = getBundledServerPath(context);
          const nodeModulesPath = path.resolve(path.dirname(serverPath), '..', 'node_modules');
          return [createStdioDefinition(
            MCP_SERVER_LABEL,
            'node',
            [serverPath],
            { AIRTABLE_HEADLESS_ONLY: '1', NODE_PATH: nodeModulesPath },
            version
          )];
        } catch (err) {
          console.error('[AirtableFormula] MCP provider error:', err);
          return [];
        }
      },
    })
  );
}
