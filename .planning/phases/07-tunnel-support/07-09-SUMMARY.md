---
phase: 07-tunnel-support
plan: 09
subsystem: ui
tags: [react, zustand, webview, vscode, tunnel, ngrok, cloudflare]

# Dependency graph
requires:
  - phase: 07-08
    provides: DashboardProvider tunnel handlers, extension.ts tunnel command wiring, TunnelState in DashboardState
  - phase: 07-07
    provides: TunnelState, TunnelProviderId, TunnelStatus types in shared package + WebviewMessage tunnel variants
provides:
  - Tunnel glass-panel section in Setup tab (Remote Access eyebrow, provider picker, ngrok inputs, URL copy, enable/disable CTA)
  - store.ts enableTunnel / disableTunnel / setNgrokAuthtoken actions
  - airtableFormula.tunnel.disable command registration in package.json
  - @ngrok/ngrok marked external in bundle-mcp.mjs (build fix)
affects:
  - 07-10 (any future tunnel-related follow-ups)
  - release (VSIX packaging includes updated webview build)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tunnel store actions follow fire-and-forget pattern (sendToExtension + pendingActions Set) matching setupIde/setupAll"
    - "Tunnel glass-panel is the first child of stack stack-lg, above IDE Configuration section"
    - "@ngrok/ngrok declared external in esbuild (same as patchright) to avoid NAPI .node bundling errors"

key-files:
  created: []
  modified:
    - packages/webview/src/store.ts
    - packages/webview/src/tabs/Setup.tsx
    - packages/extension/package.json
    - scripts/bundle-mcp.mjs

key-decisions:
  - "Tunnel actions use fire-and-forget pattern (not Promise-based) to match the existing store pattern exactly"
  - "Tunnel panel placed as FIRST glass-panel child (above IDE Configuration) per 07-PATTERNS.md spec"
  - "@ngrok/ngrok added to esbuild external list to fix pre-existing build failure introduced in plan 07-06"

patterns-established:
  - "Tunnel store actions: randomId() + pendingActions Set + sendToExtension, no promise wrapping"
  - "Provider picker disabled (opacity 0.6) when tunnel.status === active or starting (T-07-26 mitigation)"
  - "ngrok authtoken input uses type=password with aria-describedby helper text"

requirements-completed: [TUNNEL-01, TUNNEL-02, TUNNEL-03, TUNNEL-04]

# Metrics
duration: 18min
completed: 2026-05-15
---

# Phase 07 Plan 09: Tunnel Setup Tab UI and Store Actions Summary

**Tunnel glass-panel with provider picker, ngrok authtoken/domain inputs, 401-burst warning banner, and URL copy button wired to new enableTunnel/disableTunnel/setNgrokAuthtoken Zustand store actions**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-15T13:00:00Z
- **Completed:** 2026-05-15T13:18:00Z
- **Tasks:** 2 (Task 1: store actions, Task 2: Setup.tsx + package.json)
- **Files modified:** 4

## Accomplishments
- Three tunnel actions added to store.ts: enableTunnel, disableTunnel, setNgrokAuthtoken — all fire-and-forget following the setupIde pattern
- Tunnel glass-panel inserted as first section in Setup.tsx with full UI-SPEC copywriting: "Remote Access" eyebrow, dynamic detail line, status chip, 401-burst warning banner (role=alert), provider picker (cf-quick/ngrok/cf-named), conditional ngrok authtoken (type=password) and domain inputs, tunnel URL with copy button, and Enable/Disable Tunnel CTAs
- airtableFormula.tunnel.disable registered in package.json contributes.commands
- Fixed pre-existing build failure: @ngrok/ngrok added to esbuild external list in bundle-mcp.mjs

## Task Commits

Each task was committed atomically:

1. **Tasks 1 + 2: store actions, Setup.tsx, package.json, bundle fix** - `8e90a43` (feat)

**Plan metadata:** (pending final docs commit)

## Files Created/Modified
- `packages/webview/src/store.ts` - Added TunnelProviderId import; added enableTunnel, disableTunnel, setNgrokAuthtoken actions to Store interface and implementation
- `packages/webview/src/tabs/Setup.tsx` - Added tunnel glass-panel as first child of stack; all UI-SPEC components and copywriting
- `packages/extension/package.json` - Added airtableFormula.tunnel.disable to contributes.commands
- `scripts/bundle-mcp.mjs` - Added @ngrok/ngrok to external list (Rule 3 auto-fix)

## Decisions Made
- Tunnel actions use fire-and-forget pattern (not Promise-based): the plan's pseudocode showed a `pendingActions.set(id, resolve)` Map pattern, but the actual store uses a `Set<string>` and `markActionDone` callback from `action:result` messages. Adapted to match the real implementation.
- ngrok authtoken input is shown only when `selectedProvider === 'ngrok' && !tunnel?.ngrokAuthtokenSet` — once stored in SecretStorage the input disappears per UI-SPEC.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed @ngrok/ngrok esbuild bundling failure**
- **Found during:** Task 2 verification (pnpm build)
- **Issue:** `@ngrok/ngrok` ships platform-specific NAPI `.node` binaries that esbuild cannot process. The build had been failing since plan 07-04/07-06 introduced ngrok support but never updated bundle-mcp.mjs.
- **Fix:** Added `'@ngrok/ngrok'` to the `external` array in `scripts/bundle-mcp.mjs` alongside `patchright` and `patchright-core`. The library is dynamically imported at runtime so externalising it is the correct approach.
- **Files modified:** `scripts/bundle-mcp.mjs`
- **Verification:** `pnpm build` exits 0; all MCP bundles written successfully
- **Committed in:** `8e90a43` (same task commit)

---

**Total deviations:** 1 auto-fixed (1 blocking build fix)
**Impact on plan:** Essential for build correctness. Not scope creep — the ngrok provider was added in earlier plans but the external declaration was omitted.

## Issues Encountered
- Plan pseudocode for store actions used a Promise-based pattern with a `pendingActions` Map. The actual store uses a `Set<string>` with fire-and-forget dispatch. Adapted immediately on reading store.ts — no rework needed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Tunnel UI is fully wired: enable/disable/status/URL all flow through existing DashboardProvider handlers
- ngrok authtoken is stored/retrieved via extension SecretStorage (Plans 07-07, 07-08)
- Phase 07 tunnel support is now complete end-to-end

## Self-Check

Checking created/modified files exist and commit is recorded:

- `packages/webview/src/store.ts` - FOUND (modified)
- `packages/webview/src/tabs/Setup.tsx` - FOUND (modified)
- `packages/extension/package.json` - FOUND (modified)
- `scripts/bundle-mcp.mjs` - FOUND (modified)
- Commit `8e90a43` - FOUND in git log

## Self-Check: PASSED

---
*Phase: 07-tunnel-support*
*Completed: 2026-05-15*
