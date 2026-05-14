---
plan: 05-05
phase: 05-daemon-core
wave: 5
status: complete
completed: 2026-05-14
commit: e9e457b
---

# Plan 05-05 — SUMMARY

## What was done

Added the daemon attach-proxy block to `packages/mcp-server/src/index.js`. When `AIRTABLE_NO_DAEMON` is not set and the daemon lockfile exists, the MCP entry point now bridges stdio↔HTTP instead of starting an in-process server.

### Files modified
- `packages/mcp-server/src/index.js` — attach-proxy block inserted between CLI dispatch and original in-process server code

## Key implementation details

### Attach-proxy block structure
```javascript
if (cliArgs.length === 0 && !process.env.AIRTABLE_NO_DAEMON) {
  const { ensureDaemon } = await import('./daemon/launcher.js');
  const { read: readLockfile } = await import('./daemon/lockfile.js');
  const configDir = getHomeDir();
  const existing = readLockfile({ lockPath: configDir + '/daemon.lock' });
  if (existing) {
    // bridges StdioServerTransport ↔ StreamableHTTPClientTransport
    // fallback: logs warning and continues to in-process path
  }
}
```

### Fallback behavior
- If lockfile missing: skip attach block, fall through to in-process
- If `ensureDaemon` throws: log `[airtable-mcp] daemon unreachable; falling back...`, fall through to in-process
- `AIRTABLE_NO_DAEMON=1`: skip entire block unconditionally

### Bridge wiring
- `stdioTransport.onmessage` → `httpTransport.send`
- `httpTransport.onmessage` → `stdioTransport.send`
- `onclose`/`onerror` on either side → calls `settle()` which closes both + exits

## Requirements covered
- DAEMON-01: When daemon healthy, index.js attaches to HTTP endpoint instead of starting in-process
- TDD: `test-daemon-attach.test.js` 2 tests now GREEN (AIRTABLE_NO_DAEMON present before readLockfile, in-process Server constructor retained)

## Test results
All 96 mcp-server tests pass after this change.
