---
plan: 05-04
phase: 05-daemon-core
wave: 4
status: complete
completed: 2026-05-14
commit: e735add
---

# Plan 05-04 — SUMMARY

## What was done

Ported `launcher.ts` from Perplexity reference as plain ESM JavaScript with tunnel/OAuth/profile-watcher stripped. Created `daemon/index.js` barrel. Added daemon subcommands to `cli.js`.

### Files created
- `packages/mcp-server/src/daemon/launcher.js` — ensureDaemon, startDaemon, stopDaemon, getDaemonStatus, spawnDetachedDaemon, restartDaemon
- `packages/mcp-server/src/daemon/index.js` — barrel re-export of all 4 daemon modules

### Files modified
- `packages/mcp-server/src/cli.js` — added `daemon start|stop|status` subcommands and AIRTABLE_NO_DAEMON to help text

## Key implementation details

### Token drift healing (DAEMON-04)
`getDaemonStatus()` tracks `healed` flag. When `probeHealth()` returns null:
1. Reads `daemon.token` via `readToken()`
2. If `tokenRecord.bearerToken !== record.bearerToken`, re-probes with fresh token
3. If healthy with fresh token AND `reclaimStale: true`, calls `replace()` with healed record
4. Returns `{ healed: true, ... }` in the returned status

### spawnDetachedDaemon
- Resolves entry: checks `../index.mjs` first (bundled), falls back to `../index.js` (source)
- Deletes `AIRTABLE_NO_DAEMON` and `AIRTABLE_HEADLESS_ONLY` from child env
- Injects `AIRTABLE_USER_MCP_HOME: configDir`
- Spawns with `detached: true, stdio: 'ignore'` + `child.unref()`

### Provisional lockfile record (Airtable schema)
`{ pid, uuid, port, port_lsp: null, bearerToken, version, startedAt, tunnelUrl: null }`

## Requirements covered
- DAEMON-03: startDaemon acquires lockfile, starts server, writes real port, registers signal handlers
- DAEMON-04: getDaemonStatus heals lockfile on 401/token drift
- DAEMON-06: stopDaemon sends /daemon/shutdown with bearer; SIGTERM/SIGKILL as force path

## Remaining RED scaffolds (expected)
- `test-daemon-attach.test.js` (2 stubs) — waiting for `index.js` attach proxy (Wave 5)
