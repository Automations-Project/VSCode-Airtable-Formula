---
phase: 5
slug: daemon-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (mcp-server), `vitest` (extension) |
| **Config file** | `packages/mcp-server/package.json` scripts.test: `node --test "test/*.test.js"` |
| **Quick run command** | `pnpm -F airtable-user-mcp test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -F airtable-user-mcp test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | DAEMON-04, DAEMON-07 | — | N/A (TDD scaffolds) | unit | `node --test packages/mcp-server/test/test-lockfile.test.js` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | DAEMON-05, EXT-01 | — | N/A (TDD scaffolds) | unit | `pnpm -F airtable-formula vitest run -t "daemon"` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | DAEMON-04 | T-lockfile-stale | Stale PID lockfile auto-reclaimed; live lockfile not reclaimed | unit | `node --test packages/mcp-server/test/test-lockfile.test.js` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 2 | DAEMON-07 | T-token-info | Token persists in daemon.token; rotation writes new random bytes | unit | `node --test packages/mcp-server/test/test-token.test.js` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 3 | DAEMON-05 | T-bearer-auth | /daemon/health returns 401 without bearer; returns JSON with bearer | unit | `node --test packages/mcp-server/test/test-daemon-server.test.js` | ❌ W0 | ⬜ pending |
| 05-04-01 | 04 | 4 | DAEMON-03, DAEMON-04 | T-zombie | getDaemonStatus heals lockfile on 401 (token drift); treatSelfAsZombie reclaims self-pid | unit | `node --test packages/mcp-server/test/test-lockfile.test.js` | ❌ W0 | ⬜ pending |
| 05-04-02 | 04 | 4 | DAEMON-06 | — | stopDaemon sends SIGTERM then SIGKILL after timeout | unit | `pnpm -F airtable-user-mcp test` | ❌ W0 | ⬜ pending |
| 05-05-01 | 05 | 5 | DAEMON-01 | T-nodaemon | AIRTABLE_NO_DAEMON=1 bypasses attach proxy, runs in-process immediately | unit | `node --test packages/mcp-server/test/test-daemon-attach.test.js` | ❌ W0 | ⬜ pending |
| 05-06-01 | 06 | 5 | EXT-02, EXT-03 | T-credleak | buildDaemonEnv includes AIRTABLE_USER_MCP_HOME; bearer token NOT in console.log | unit | `pnpm -F airtable-formula vitest run -t "DaemonManager"` | ❌ W0 | ⬜ pending |
| 05-06-02 | 06 | 5 | EXT-02 | — | useDaemon setting read from VS Code config; defaults to true | unit | `pnpm -F airtable-formula vitest run -t "useDaemon"` | ❌ W0 | ⬜ pending |
| 05-07-01 | 07 | 6 | EXT-01 | — | registration.ts returns HTTP def when McpHttpServerDefinition exists + daemon healthy | unit | `pnpm -F airtable-formula vitest run -t "daemon HTTP definition"` | ❌ W0 | ⬜ pending |
| 05-07-02 | 07 | 6 | EXT-02, EXT-03 | — | AuthManager.init() calls ensureDaemon() when useDaemon is true | unit | `pnpm -F airtable-formula vitest run -t "ensureDaemon"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/mcp-server/test/test-lockfile.test.js` — stubs for DAEMON-04 (stale reclaim, atomic acquire, token drift healing)
- [ ] `packages/mcp-server/test/test-token.test.js` — stubs for DAEMON-07 (ensureToken, rotateToken, token file persistence)
- [ ] `packages/mcp-server/test/test-daemon-server.test.js` — stubs for DAEMON-05 (bearer auth middleware, /daemon/health, /daemon/events SSE)
- [ ] `packages/mcp-server/test/test-daemon-attach.test.js` — stubs for DAEMON-01 (AIRTABLE_NO_DAEMON bypass, in-process fallback)
- [ ] `packages/extension/src/test/daemon-manager.test.ts` — stubs for EXT-01, EXT-02, EXT-03 (buildDaemonEnv, probeHealth mock, HTTP duck-type, ensureDaemon call)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two MCP clients share one Chromium session | DAEMON-02 | Requires live browser process; no stub possible | Start daemon, connect two stdio clients via `npx airtable-user-mcp`, verify single daemon.lock file and single node process in Task Manager |
| Daemon survives VS Code extension reload | DAEMON-03 | Requires VS Code window reload event | Open VS Code, reload extension window (Ctrl+Shift+P → "Developer: Reload Window"), verify daemon.lock PID unchanged |
| Daemon starts automatically on VS Code activation | DAEMON-03 | Requires VS Code process | Activate extension, check `~/.airtable-user-mcp/daemon.lock` exists within 15s |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
