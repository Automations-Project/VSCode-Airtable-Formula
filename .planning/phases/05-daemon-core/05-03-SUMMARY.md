---
plan: 05-03
phase: 05-daemon-core
wave: 3
status: complete
completed: 2026-05-14
commit: 397fd89
---

# Plan 05-03 — SUMMARY

## What was done

Ported `server.ts` from the VSCode-Perplexity-MCP reference as plain ESM JavaScript, with OAuth 2.1, helmet, audit log, and tunnel routes removed.

### Files created
- `packages/mcp-server/src/daemon/server.js` — `startDaemonServer` export

### Tests upgraded from RED to GREEN
- `packages/mcp-server/test/test-daemon-server.test.js` — 5 tests, all pass

## What was kept vs removed from reference

| Kept | Removed |
|------|---------|
| requireBearer middleware | OAuth 2.1 (authorize/token/register/revoke) |
| GET /daemon/health, /daemon/events | helmet middleware |
| POST /daemon/heartbeat, /daemon/rotate-token, /daemon/shutdown | appendAuditEntry, readAuditTail |
| listenAvoidingBlockedPorts + FETCH_BLOCKED_PORTS | /daemon/enable-tunnel, /daemon/disable-tunnel |
| SSE publishEvent | Public pages (homepage, robots, favicon) |
| Server + StreamableHTTPServerTransport at /mcp | PerplexityClient → AirtableAuth/AirtableClient |

## Architectural note

Uses old `Server` class (not `McpServer`) to stay compatible with `toolConfig.bindServer()` which calls `server.sendToolListChanged()`. Full tool registration (all 62 tools) wired via `options.getTools` + `options.callTool` callbacks — supplied by `launcher.js` in Wave 4.

## Requirements covered

- DAEMON-05: /daemon/health and /daemon/events guarded by bearer token
- DAEMON-02 (partial): /mcp endpoint with bearer auth and StreamableHTTPServerTransport

## Remaining RED scaffolds (expected)

- `test-daemon-attach.test.js` (2 stubs) — waiting for `index.js` attach proxy (Wave 5)
