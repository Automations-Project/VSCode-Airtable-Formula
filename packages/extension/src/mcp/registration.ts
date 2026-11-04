import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { MCP_PROVIDER_ID, MCP_SERVER_LABEL } from '../constants.js';
import { getBundledServerPath } from './server-path.js';
import type { AuthManager } from './auth-manager.js';
import type { DaemonManager } from './daemon-manager.js';
import { getSettings, minutesToIdleParkMs } from '../settings.js';

type McpCtor = new (...args: unknown[]) => unknown;

/** Stable client id for VS Code → daemon MCP calls (pageBusy.clientId). */
export const VSCODE_MCP_CLIENT_ID = 'vscode-airtable-formula';

export function createHttpDefinition(
  url: string,
  authHeader: string,
  clientId: string = VSCODE_MCP_CLIENT_ID,
): unknown | null {
  const httpCtor = (vscode as unknown as { McpHttpServerDefinition?: McpCtor }).McpHttpServerDefinition;
  if (!httpCtor) return null;
  const headers: Record<string, string> = {
    Authorization: authHeader,
    'x-airtable-client-id': clientId,
  };
  try {
    return new httpCtor({ url, headers });
  } catch {
    return new httpCtor(url, headers);
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
          // Declared out here so the stdio fallback below can tell "the daemon is
          // serving us" from "we fell through" — the credential branch depends on it.
          let daemon: { port: number; bearerToken: string } | null = null;
          if (settings.mcp.useDaemon && daemonManager) {
            // START the daemon, don't just look for one. A passive getDaemonStatus()
            // meant an MCP request could never bring the daemon up, so unless the user
            // had opened the dashboard (or run a formula command) EVERY session fell
            // through to the stdio branch below — and that branch is the one that
            // contends for the shared .chrome-profile, once per VS Code window. One
            // shared daemon is the configuration that avoids Chrome exit 21, so
            // starting it here makes profile collisions LESS likely, not more.
            //
            // implicit:true is load-bearing: it keeps the _userStopped latch (a
            // deliberate Stop must not be undone by the next tool call) and the
            // SPAWN_SUPPRESS_MS window that closed the runaway-spawn OOM documented
            // in daemon-manager.ts. Never pass implicit:false from here.
            //
            // Timeout matches ensureDaemon's own default and SPAWN_SUPPRESS_MS. It is
            // a ceiling, not a cost: a healthy daemon returns on the first poll.
            // ponytail: on failure we fall through to stdio rather than returning [],
            // so MCP still works when the daemon can't start. That leaves a narrow
            // window where a late-arriving daemon and the stdio server both drive the
            // same profile; give the fallback its own AIRTABLE_PROFILE_DIR if that
            // ever shows up in the wild.
            try {
              const info = await daemonManager.ensureDaemon({ implicit: true, timeoutMs: 15_000 });
              if (info?.port != null && info.bearerToken != null) {
                daemon = { port: info.port, bearerToken: info.bearerToken };
              }
            } catch {
              daemon = null;
            }
            if (daemon) {
              const httpDef = createHttpDefinition(
                `http://127.0.0.1:${daemon.port}/mcp`,
                `Bearer ${daemon.bearerToken}`,
              );
              if (httpDef) return [httpDef];
              // A definition we could not construct is not a served daemon — fall
              // through to stdio AND let the credential branch know it must inject.
              daemon = null;
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
          env.AIRTABLE_BROWSER_IDLE_PARK_MS = String(minutesToIdleParkMs(settings.mcp.browserIdleParkMinutes));

          // Pass stored credentials so MCP server can auto-recover sessions.
          // Env is acceptable here — VS Code owns the stdio spawn (the daemon
          // path never gets creds in env; it uses /daemon/auth-credentials).
          if (authManager) {
            const authMode = settings.mcp.authMode;
            const isCredMode = authMode === 'byo' || authMode === 'direct-login';
            if (isCredMode && !daemon) {
              // Gate on "did we actually fall through to stdio", NOT on the useDaemon
              // SETTING. Those used to be the same thing; they no longer are. useDaemon
              // defaults true, so with the setting-based test a byo/direct-login user
              // who reached this branch — daemon failed to start, or they pressed Stop —
              // got a stdio server with NO credentials and no browser to fall back on:
              // *_CREDENTIALS_MISSING on every tool call. `daemon` is null here exactly
              // when the daemon is not serving us, which is precisely when env is once
              // again the only credential channel VS Code gives a stdio spawn.
              // When the daemon IS serving, /daemon/auth-credentials stays the SINGLE
              // channel — secrets are still never duplicated into env on that path.
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
