---
plan: 05-06
phase: 05-daemon-core
wave: 5
status: complete
completed: 2026-05-14
commit: fd92021
---

# Plan 05-06 — SUMMARY

## What was done

Created `DaemonManager` class in the extension, added `createHttpDefinition` helper to `registration.ts`, added `mcp.useDaemon` to settings, and registered the VS Code setting in `package.json`.

### Files created
- `packages/extension/src/mcp/daemon-manager.ts` — DaemonManager class, DaemonStatus interface, DaemonConnectionInfo interface

### Files modified
- `packages/extension/src/mcp/registration.ts` — added `export function createHttpDefinition(url, authHeader)` duck-type helper
- `packages/extension/src/settings.ts` — added `useDaemon: boolean` to Settings interface and `cfg.get('mcp.useDaemon', true)` in getSettings()
- `packages/extension/package.json` — added `airtableFormula.mcp.useDaemon` boolean setting (default: true)
- `packages/extension/src/test/daemon-manager.test.ts` — added `McpHttpServerDefinition: undefined` to vscode mock for vitest strict mode compat

## Key implementation details

### DaemonManager class shape
- Implements `vscode.Disposable` via `_onDidChange` EventEmitter
- Constructor: `(configDir: string, extensionPath: string)`
- Private `_httpHealthCheck(port, bearerToken)` avoids circular call chain between `getDaemonStatus`/`probeHealth`
- `getDaemonStatus()` reads `daemon.lock`, calls `_httpHealthCheck` directly — no `probeHealth()` call (avoids infinite recursion)
- `probeHealth()` calls `getDaemonStatus()` and returns `status.running && status.healthy`
- `buildDaemonEnv()`: returns `{ AIRTABLE_USER_MCP_HOME, AIRTABLE_HEADLESS_ONLY: '1', NODE_PATH, ...credEnv }`
- `_spawnDetached()`: spawns `process.execPath [extensionPath/dist/mcp/index.mjs, 'daemon', 'start']` with `detached: true, stdio: 'ignore'`

### createHttpDefinition duck-type pattern
```typescript
export function createHttpDefinition(url: string, authHeader: string): unknown | null {
  const httpCtor = (vscode as unknown as { McpHttpServerDefinition?: McpCtor }).McpHttpServerDefinition;
  if (!httpCtor) return null;
  return new httpCtor({ url, headers: { Authorization: authHeader } });
}
```
Returns `null` when `McpHttpServerDefinition` is not present (VS Code < 1.100 or builds without HTTP MCP support).

## Requirements covered
- DAEMON-03: ensureDaemon polls every 200ms up to 15s, spawns detached process once when not running
- DAEMON-06: stopDaemon sends POST /daemon/shutdown with bearer token, 3s timeout
- DAEMON-07: DaemonManager implements vscode.Disposable
- EXT-02: DaemonManager class exists (wave 5 portion)
- EXT-03: buildDaemonEnv returns AIRTABLE_USER_MCP_HOME, AIRTABLE_HEADLESS_ONLY, NODE_PATH

## Test results
All 50 extension tests pass. Extension build clean (9.59 MB dist/extension.js, no TypeScript errors).
