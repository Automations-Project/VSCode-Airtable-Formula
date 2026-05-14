---
plan: 05-07
phase: 05-daemon-core
wave: 6
status: complete
completed: 2026-05-14
commit: d788fb3
---

# Plan 05-07 — SUMMARY

## What was done

Wired DaemonManager into the extension's MCP registration and auth flow. Updated `registration.ts` with the HTTP definition branch, updated `auth-manager.ts` to inject DaemonManager and call `ensureDaemon()` before credentials, updated `extension.ts` to instantiate and inject DaemonManager, and registered stop/restart commands in both code and package.json.

### Files modified
- `packages/extension/src/mcp/registration.ts` — added `import type { DaemonManager }`, `daemonManager?` parameter to `registerMcpProvider`, HTTP definition branch at top of `provideMcpServerDefinitions`, and `AIRTABLE_NO_DAEMON: '1'` in the stdio fallback env
- `packages/extension/src/mcp/auth-manager.ts` — added `import type { DaemonManager }`, `private _daemonManager?` field, optional `daemonManager` constructor param, and `ensureDaemon()` call in `getCredentialsEnv()` (D-02)
- `packages/extension/src/extension.ts` — added `import { DaemonManager }`, instantiation before AuthManager, injection into AuthManager and `registerMcpProvider`, `stopDaemon`/`restartDaemon` commands
- `packages/extension/package.json` — added `stopDaemon` and `restartDaemon` command contributions

## Key implementation details

### HTTP definition branch in registration.ts
```typescript
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
```

### Stdio fallback always includes `AIRTABLE_NO_DAEMON: '1'`
Prevents the bundled `index.mjs` from spending 15s polling for a daemon when falling back to per-session stdio mode (Pitfall 6 fix from RESEARCH.md).

### D-02 gate in auth-manager.ts
```typescript
async getCredentialsEnv(): Promise<Record<string, string> | undefined> {
  if (getSettings().mcp.useDaemon && this._daemonManager) {
    await this._daemonManager.ensureDaemon();
  }
  // ... credential retrieval ...
}
```

### DaemonManager instantiation in extension.ts
```typescript
const daemonConfigDir = path.join(os.homedir(), '.airtable-user-mcp');
const daemonManager = new DaemonManager(daemonConfigDir, context.extensionPath);
context.subscriptions.push(daemonManager);
```

## Requirements covered
- DAEMON-03: ensureDaemon() called via auth-manager before credential hand-off
- DAEMON-06: stopDaemon/restartDaemon commands registered in extension + package.json
- EXT-01: createHttpDefinition duck-type branch in provideMcpServerDefinitions
- EXT-02: DaemonManager injected into AuthManager (optional constructor param)
- EXT-03: DaemonManager.buildDaemonEnv used via _spawnDetached when ensureDaemon spawns

## Test results
All 251 tests pass (193 mcp-server + 8 webview + 50 extension). Extension build clean (9.60 MB, no TypeScript errors).
