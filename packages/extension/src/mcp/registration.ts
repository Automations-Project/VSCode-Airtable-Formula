import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { MCP_PROVIDER_ID, MCP_SERVER_LABEL } from '../constants.js';
import { getBundledServerPath } from './server-path.js';
import type { AuthManager } from './auth-manager.js';
import type { DaemonManager } from './daemon-manager.js';
import { getSettings } from '../settings.js';

type McpCtor = new (...args: unknown[]) => unknown;

export function createHttpDefinition(url: string, authHeader: string): unknown | null {
  const httpCtor = (vscode as unknown as { McpHttpServerDefinition?: McpCtor }).McpHttpServerDefinition;
  if (!httpCtor) return null;
  try {
    return new httpCtor({ url, headers: { Authorization: authHeader } });
  } catch {
    return new httpCtor(url, { Authorization: authHeader });
  }
}

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
  onChanged: vscode.EventEmitter<void>,
  authManager?: AuthManager,
  daemonManager?: DaemonManager,
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
          // ── HTTP definition branch (D-03) ──────────────────────────────
          const settings = getSettings();
          if (settings.mcp.useDaemon && daemonManager) {
            const daemonStatus = await daemonManager.getDaemonStatus();
            if (daemonStatus.healthy && daemonStatus.port != null && daemonStatus.bearerToken != null) {
              const httpDef = createHttpDefinition(
                `http://127.0.0.1:${daemonStatus.port}/mcp`,
                `Bearer ${daemonStatus.bearerToken}`,
              );
              if (httpDef) return [httpDef];
            }
          }

          // ── Stdio fallback ─────────────────────────────────────────────
          const serverPath = getBundledServerPath(context);
          const nodeModulesPath = path.resolve(path.dirname(serverPath), '..', 'node_modules');
          const env: Record<string, string> = {
            AIRTABLE_HEADLESS_ONLY: '1',
            NODE_PATH: nodeModulesPath,
            AIRTABLE_NO_DAEMON: '1',
            // Pin the config/state home to the SAME dir the daemon uses (buildDaemonEnv sets
            // AIRTABLE_USER_MCP_HOME=configDir). Without this, the stdio server falls back to its
            // own default and byo/direct-login credential files, sync state, and jobs could resolve
            // to a different directory than the daemon path.
            AIRTABLE_USER_MCP_HOME: path.join(os.homedir(), '.airtable-user-mcp'),
          };

          // Propagate debug settings as env vars for the MCP debug-tracer
          const debugSettings = settings.debug;
          if (debugSettings.enabled) {
            env.AIRTABLE_DEBUG = '1';
          }
          if (debugSettings.verboseHttp) {
            env.AIRTABLE_DEBUG_VERBOSE = '1';
          }

          // Transport selection (airtableFormula.mcp.authMode / .httpClient). Only inject
          // non-defaults so an externally-set env still applies at the default.
          if (settings.mcp.authMode && settings.mcp.authMode !== 'browser') {
            env.AIRTABLE_AUTH_MODE = settings.mcp.authMode;
          }
          if (settings.mcp.httpClient === 'impit') {
            env.AIRTABLE_HTTP_CLIENT = 'impit';
          }

          // Pass stored credentials so MCP server can auto-recover sessions.
          // Env is acceptable here — VS Code owns the stdio spawn (the daemon
          // path never gets creds in env; it uses /daemon/auth-credentials).
          if (authManager) {
            const authMode = settings.mcp.authMode;
            const isCredMode = authMode === 'byo' || authMode === 'direct-login';
            if (isCredMode && !settings.mcp.useDaemon) {
              // Pure stdio mode (no daemon): byo/direct-login REQUIRE credentials
              // (no browser), and env is the only channel VS Code gives a stdio
              // spawn. In daemon mode the daemon endpoint (/daemon/auth-credentials)
              // is the SINGLE credential channel — never duplicate secrets into env.
              const credEnv = await authManager.getCredentialsEnv(authMode);
              if (credEnv) Object.assign(env, credEnv);
            } else if (!isCredMode && settings.auth.loginMode === 'auto') {
              // Browser mode: only forward creds for the automated login flow.
              const credEnv = await authManager.getCredentialsEnv();
              if (credEnv) Object.assign(env, credEnv);
            }

            const probe = authManager.browser;
            if (probe.channel) env.AIRTABLE_BROWSER_CHANNEL = probe.channel;
            if (probe.executablePath) env.AIRTABLE_BROWSER_PATH = probe.executablePath;

            // Always pass canonical profile dir
            env.AIRTABLE_PROFILE_DIR = path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');
          }

          return [createStdioDefinition(
            MCP_SERVER_LABEL,
            'node',
            [serverPath],
            env,
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
