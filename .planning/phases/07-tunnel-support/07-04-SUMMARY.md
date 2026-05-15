---
phase: 07-tunnel-support
plan: 04
subsystem: infra
tags: [cloudflared, named-tunnel, ngrok, tunnel-providers, daemon, port-drift, D-03-schema]

# Dependency graph
requires:
  - phase: 07-02
    provides: safeAtomicWriteFileSync, install-tunnel.js, paths.js
  - phase: 07-03
    provides: cloudflared-quick.js, ngrok.js, types.js (pre-existing from parallel wave-3 executor)

provides:
  - cloudflared-named.js — cf-named provider with port-drift fix (READY_LINE_REGEX + writeTunnelConfig on every start)
  - cloudflared-named-setup.js — cf-named setup wizard (login, list, create, delete, YAML read/write)
  - index.js — Provider registry (getTunnelProvider/listTunnelProviders) + D-03 settings I/O (readTunnelSettings/writeTunnelSettings/getTunnelSettingsPath)

affects:
  - 07-05 (server.js imports getTunnelProvider/readTunnelSettings from index.js)
  - 07-06 (launcher.js imports writeTunnelSettings for autoDisabled pass-through)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - D-03 schema for tunnel-settings.json — { enabled, provider, ngrokDomain } with autoDisabled pass-through
    - Port-drift rewrite pattern — writeTunnelConfig() called on every start() before spawning cloudflared
    - Provider registry pattern — REGISTRY object + getTunnelProvider() throws on unknown ID (T-07-10)
    - Atomic settings writes via safeAtomicWriteFileSync (T-07-09)

key-files:
  created:
    - packages/mcp-server/src/daemon/tunnel-providers/cloudflared-named.js
    - packages/mcp-server/src/daemon/tunnel-providers/cloudflared-named-setup.js
    - packages/mcp-server/src/daemon/tunnel-providers/index.js
  modified:
    - packages/mcp-server/test/test-tunnel-settings.test.js (stub → real assertions)
    - packages/mcp-server/src/daemon/install-tunnel.js (assert → with for JSON import, Node 22 fix)

key-decisions:
  - "D-03 schema used instead of Perplexity activeProvider/updatedAt schema — enabled/provider/ngrokDomain"
  - "autoDisabled and autoDisabledReason are pass-through fields preserved in readTunnelSettings but not clobbered by writeTunnelSettings unless in patch"
  - "readNgrokSettings/writeNgrokSettings NOT ported — ngrok authtoken lives in VS Code SecretStorage only (D-02)"
  - "READY_LINE_REGEX = /Registered tunnel connection/i — named tunnel ready signal (not URL extraction like quick tunnel)"
  - "writeTunnelConfig() called at start of start() on every daemon restart — prevents stale port in YAML (Pitfall 3)"

patterns-established:
  - "Provider registry: REGISTRY object with string keys, getTunnelProvider throws on unknown ID"
  - "D-03 schema: enabled boolean + provider string (VALID_PROVIDERS whitelist) + ngrokDomain string|null"
  - "Port-drift fix: rewrite YAML config with current port before every cloudflared spawn"

requirements-completed:
  - TUNNEL-01
  - TUNNEL-03
  - TUNNEL-04

# Metrics
duration: 35min
completed: 2026-05-15
---

# Phase 7 Plan 04: Cloudflared Named Provider and Tunnel-Providers Registry Summary

**Named-tunnel provider with port-drift YAML rewrite + D-03 schema settings registry completing the tunnel-providers/ directory**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-15T00:00:00Z
- **Completed:** 2026-05-15T00:35:00Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- Ported cloudflared-named.js from Perplexity TypeScript — cf-named provider with READY_LINE_REGEX and port-drift fix (writeTunnelConfig on every start)
- Ported cloudflared-named-setup.js — full login/list/create/delete wizard + YAML read/write with safeAtomicWriteFileSync
- Created index.js with D-03 schema (enabled/provider/ngrokDomain), provider registry, and autoDisabled pass-through
- Replaced all stub tests in test-tunnel-settings.test.js with real assertions (7 tests, all GREEN)
- All 6 tunnel-providers/ files now complete: types, cf-quick, ngrok, cf-named, cf-named-setup, index

## Task Commits

1. **Task 1: cloudflared-named.js + cloudflared-named-setup.js** - `b6b1a21` (feat)
2. **Task 2: index.js + test fill-in + install-tunnel fix** - `aacc24e` (feat)
3. **Task 2 bug-fix: import path correction** - `36644ef` (fix)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `packages/mcp-server/src/daemon/tunnel-providers/cloudflared-named.js` — cf-named provider with READY_LINE_REGEX and port-drift rewrite
- `packages/mcp-server/src/daemon/tunnel-providers/cloudflared-named-setup.js` — setup wizard (login, list, create, delete, YAML r/w)
- `packages/mcp-server/src/daemon/tunnel-providers/index.js` — provider registry + D-03 readTunnelSettings/writeTunnelSettings
- `packages/mcp-server/test/test-tunnel-settings.test.js` — real assertions replacing stubs
- `packages/mcp-server/src/daemon/install-tunnel.js` — Node 22 JSON import syntax fix

## Decisions Made

- D-03 schema used: `{ enabled, provider, ngrokDomain }` — not Perplexity's `{ activeProvider, updatedAt }`
- `autoDisabled` and `autoDisabledReason` are pass-through fields; `readTunnelSettings` defaults return them, `writeTunnelSettings` carries them forward unless explicitly in patch
- `readNgrokSettings` / `writeNgrokSettings` NOT ported — ngrok authtoken is stored in VS Code SecretStorage exclusively (D-02)
- `READY_LINE_REGEX = /Registered tunnel connection/i` — named tunnel does not emit a URL; ready signal is this log line; URL is static `https://<hostname>`
- `writeTunnelConfig()` called on every `start()` before spawning cloudflared — prevents port-drift when daemon restarts with a new OS-assigned port (Pitfall 3 fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed `assert { type: "json" }` → `with { type: "json" }` in install-tunnel.js**
- **Found during:** Task 1 verification (node import of cloudflared-named.js)
- **Issue:** `install-tunnel.js` used deprecated import-assertion syntax (`assert`), which Node 22 does not support. cloudflared-named.js imports cloudflared-named-setup.js which imports install-tunnel.js, causing all tunnel-related imports to fail.
- **Fix:** Changed line 5 of install-tunnel.js from `assert { type: "json" }` to `with { type: "json" }`
- **Files modified:** `packages/mcp-server/src/daemon/install-tunnel.js`
- **Verification:** All 7 tunnel settings + provider registry tests pass GREEN after fix
- **Committed in:** `aacc24e` (Task 2 commit)

**2. [Rule 1 - Bug] Fixed relative import path for getHomeDir (../paths.js → ../../paths.js)**
- **Found during:** Task 2 test run
- **Issue:** `cloudflared-named.js` and `cloudflared-named-setup.js` both imported `getHomeDir` from `'../paths.js'`, which resolves to `src/daemon/paths.js` (non-existent). Correct path is `'../../paths.js'` → `src/paths.js`.
- **Fix:** Updated both import statements to `'../../paths.js'`
- **Files modified:** `cloudflared-named.js`, `cloudflared-named-setup.js`
- **Verification:** 7 tests pass after fix
- **Committed in:** `36644ef` (fix commit)

---

**Total deviations:** 2 auto-fixed (1 blocking — Node 22 syntax, 1 bug — wrong import path)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered

- The plan's acceptance criterion `grep -c "getHomeDir" cloudflared-named.js returns at least 1` required adding `getHomeDir` to a file where the Perplexity source only used `homedir()` from node:os. The resolution was to import `getHomeDir` from `../../paths.js` and use it as the default `configDir` fallback in `start()`, which is also semantically correct.
- Pre-existing 4 test failures in `test-tunnel-allowlist.test.js` are unchanged before and after this plan.

## User Setup Required

None — no external service configuration required.

## Threat Model Coverage

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-07-09: Tampering via partial write | writeTunnelSettings uses safeAtomicWriteFileSync (tmp + rename) | Implemented |
| T-07-10: Provider ID injection | getTunnelProvider throws on unknown ID; writeTunnelSettings validates against VALID_PROVIDERS | Implemented |
| T-07-11: ngrok authtoken on disk | writeTunnelSettings writes only ngrokDomain; authtoken never in any file | Implemented (no writeNgrokSettings) |

## Known Stubs

None — all exported functions are fully implemented with real logic. Test assertions are real (not stubs).

## Next Phase Readiness

- All 6 tunnel-providers/ files complete — server.js (Plan 05) can now import `getTunnelProvider`, `readTunnelSettings` from index.js
- launcher.js (Plan 06) can import `writeTunnelSettings` for the autoDisabled pass-through
- cf-named setup flow can be driven from extension via `runCloudflaredLogin`, `createNamedTunnel`, `writeTunnelConfig` exports

---
*Phase: 07-tunnel-support*
*Completed: 2026-05-15*
