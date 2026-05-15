---
phase: 07-tunnel-support
plan: 02
subsystem: mcp-server
tags: [tunnel, cloudflared, safe-write, daemon, supply-chain, mcp-server]

# Dependency graph
requires:
  - 07-01 (Wave 0 test stubs)
provides:
  - safe-write.js atomic write utility (TUNNEL-01)
  - cloudflared-pins.json pinned checksums v2026.3.0 (TUNNEL-02)
  - tunnel.js cloudflared subprocess lifecycle (TUNNEL-01)
  - install-tunnel.js binary download + SHA-256 verification (TUNNEL-02)
affects:
  - 07-03 (tunnel providers consume install-tunnel.js + tunnel.js)
  - 07-04 (tunnel-settings consumes safe-write.js)
  - 07-05 (daemon server hosts lifecycle from tunnel.js)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Atomic write via .tmp + rename pattern (safe-write.js)
    - SHA-256 supply chain verification before binary write (install-tunnel.js)
    - Windows-safe process kill via taskkill /PID /T /F (tunnel.js)
    - Neutral cloudflared config to prevent ~/.cloudflared/config.yml hijack (tunnel.js)
    - JSON import assertion for cloudflared-pins.json (install-tunnel.js)

key-files:
  created:
    - packages/mcp-server/src/safe-write.js
    - packages/mcp-server/src/daemon/cloudflared-pins.json
    - packages/mcp-server/src/daemon/tunnel.js
    - packages/mcp-server/src/daemon/install-tunnel.js
  modified: []

key-decisions:
  - "Ported TypeScript → JavaScript by stripping all type annotations; no runtime behavior changed"
  - "Replaced getConfigDir() from profiles.js with getHomeDir() from paths.js — Airtable uses paths.js as the canonical config-dir accessor"
  - "NEUTRAL_CONFIG_BODY references airtable-user-mcp (not perplexity-user-mcp) for correct branding"
  - "Pre-existing 4 test failures confirmed pre-date this plan (Wave 0 RED allowlist stubs from 07-01)"

requirements-completed:
  - TUNNEL-01
  - TUNNEL-02

# Metrics
duration: 15min
completed: 2026-05-15
---

# Phase 07 Plan 02: Tunnel Utilities Port Summary

**Four foundational tunnel utility files ported from Perplexity source: atomic write, pinned cloudflared checksums (v2026.3.0, 5 platforms), subprocess lifecycle with Windows-safe kill and neutral config, and binary download with SHA-256 supply chain verification**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-15T00:14:00Z
- **Completed:** 2026-05-15T00:29:54Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `safe-write.js` exporting `safeAtomicWriteFileSync` — writes to `.tmp` then renames atomically, cleans up `.tmp` on failure
- Created `cloudflared-pins.json` with pinned version `2026.3.0` and SHA-256 hashes for 5 platform-arch combinations (darwin-arm64, darwin-x64, linux-arm64, linux-x64, windows-x64)
- Created `tunnel.js` exporting `startTunnel` and `extractTunnelUrl` — scans both stdout and stderr for trycloudflare.com URL, uses taskkill on Windows, prevents config hijack via `ensureNeutralConfig()`
- Created `install-tunnel.js` exporting `installCloudflared`, `getTunnelBinaryPath`, `resolvePinnedAssetKey` — downloads from GitHub releases CDN, verifies SHA-256, extracts `.tgz` via tar walk, uses `getHomeDir()` from `paths.js`
- Confirmed pre-existing 4 RED test failures from 07-01 wave stubs are unchanged — no new failures introduced

## Task Commits

Each task was committed atomically:

1. **Task 1+2: All four tunnel utility files** — `94d88e8` (feat)

## Files Created/Modified

- `packages/mcp-server/src/safe-write.js` — Atomic write utility (27 lines)
- `packages/mcp-server/src/daemon/cloudflared-pins.json` — Pinned cloudflared binary checksums for v2026.3.0
- `packages/mcp-server/src/daemon/tunnel.js` — cloudflared subprocess lifecycle (167 lines, JS port of tunnel.ts)
- `packages/mcp-server/src/daemon/install-tunnel.js` — Binary download + checksum verification (97 lines, JS port of install-tunnel.ts)

## Decisions Made

- TypeScript → JavaScript port: all type annotations, interfaces, and generic parameters stripped. No runtime behavior changes.
- `getConfigDir()` → `getHomeDir()`: Airtable's mcp-server uses `paths.js` (not `profiles.js`) as the config directory accessor. The function signatures are equivalent — both return `~/.airtable-user-mcp` by default.
- `NEUTRAL_CONFIG_BODY` updated to reference `airtable-user-mcp Quick Tunnel` instead of `perplexity-user-mcp Quick Tunnel`.
- Tasks merged into a single commit because all four files are interdependent prerequisites with no intermediate verification state.

## Deviations from Plan

None — plan executed exactly as written. The 4 pre-existing test failures (tunnel allowlist RED tests from 07-01) were confirmed before and after applying changes.

## Threat Mitigations Applied

| Threat ID | Mitigation | File |
|-----------|-----------|------|
| T-07-03 | SHA-256 checksum verification from cloudflared-pins.json before writing binary to disk; throws on mismatch | install-tunnel.js |
| T-07-04 | Atomic write via .tmp + rename; rmSync .tmp on failure | safe-write.js |

## Known Stubs

None — all four files are complete implementations with no placeholder data.

---

## Self-Check

- FOUND: packages/mcp-server/src/safe-write.js
- FOUND: packages/mcp-server/src/daemon/cloudflared-pins.json
- FOUND: packages/mcp-server/src/daemon/tunnel.js
- FOUND: packages/mcp-server/src/daemon/install-tunnel.js
- FOUND: commit 94d88e8

## Self-Check: PASSED

*Phase: 07-tunnel-support*
*Completed: 2026-05-15*
