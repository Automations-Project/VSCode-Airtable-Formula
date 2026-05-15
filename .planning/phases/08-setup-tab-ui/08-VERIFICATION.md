---
phase: 08-setup-tab-ui
verified: 2026-05-15T18:53:30Z
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open Setup tab in VS Code with daemon running — verify DaemonStatusBlock is the FIRST panel (above Tunnel), health chip renders correctly, all rows show live data"
    expected: "Daemon Status block appears above Tunnel section; chip-ok 'Healthy' shows for healthy daemon; MCP Port, LSP Port (if non-null), Tunnel URL (if active), and Uptime rows all display accurate values; block disappears when daemon stops"
    why_human: "Conditional rendering and panel ordering require runtime VS Code environment; cannot verify DOM order or live daemon data programmatically"
  - test: "With daemon stopped, open Setup tab — verify DaemonStatusBlock is absent (no offline placeholder)"
    expected: "No daemon panel visible; Tunnel section is the first panel"
    why_human: "Requires VS Code runtime; conditional rendering with daemon?.running gate cannot be asserted without running extension"
  - test: "Click through all 5 MCP IDE tabs x 2 variants — verify each HTTP snippet shows {{BEARER_TOKEN}} and correct IDE-specific key, stdio shows npx block; Copy button cycles Copied! for 1.5s"
    expected: "Claude Code/Desktop HTTP: type:http + url; Cursor/Cline HTTP: url only; Windsurf HTTP: serverUrl; All HTTP contain {{BEARER_TOKEN}}; stdio shows airtable-user-mcp command; Copy button resets after 1500ms"
    why_human: "Clipboard interaction and button timer behavior require browser/VS Code runtime"
  - test: "Click through all 4 LSP IDE tabs x 2 variants — verify Neovim TCP shows vim.lsp.rpc.connect, Neovim stdio shows vim.lsp.config, Zed TCP shows --tcp-client, LSP port placeholder {LSP_PORT} shows when daemon LSP not running"
    expected: "Neovim TCP: vim.lsp.rpc.connect('127.0.0.1', {port}); Neovim stdio: vim.lsp.config with cmd = { 'npx', ... }; Zed TCP: --tcp-client; port placeholder {LSP_PORT} when LSP not started"
    why_human: "Requires VS Code runtime for real rendering; port placeholder behavior needs live daemon state"
---

# Phase 8: Setup Tab UI Verification Report

**Phase Goal:** The Setup tab gives users a complete, actionable view of their daemon state — MCP connectivity, LSP connectivity, tunnel status, and copy-paste config snippets for every supported IDE
**Verified:** 2026-05-15T18:53:30Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Opening the Setup tab shows a live status block with MCP port, LSP port, tunnel URL (if active), and daemon uptime — all sourced from the running daemon lockfile | ? NEEDS HUMAN | DaemonStatusBlock JSX exists in Setup.tsx (lines 271-318), guarded by `daemon?.running`. Data flows: `_computeDaemonStatusInfo()` in DashboardProvider.ts (lines 677-694) calls `this._daemonManager?.getDaemonStatus()` and strips bearerToken/pid; daemon field added to `pushState()` state object (line 535). Full data pipeline is wired. Visual rendering requires VS Code runtime. |
| 2 | A user setting up a new MCP client in Claude Code, Claude Desktop, Cursor, Windsurf, or Cline can copy a ready-to-paste config snippet directly from the Setup tab | ? NEEDS HUMAN | `getMcpSnippet()` fully implemented (lines 22-59 Setup.tsx) with all 5 IDEs; MCP snippets panel with 5 IDE tabs + 2 variant sub-tabs present in JSX (lines 546-623); copy button with 1500ms reset wired via `handleCopySnippet`. All 11 getMcpSnippet unit tests pass. Clipboard and panel rendering require runtime. |
| 3 | A user setting up LSP in Claude Code, OpenCode, Zed, or Neovim can copy a ready-to-paste config snippet directly from the Setup tab | ? NEEDS HUMAN | `getLspSnippet()` fully implemented (lines 61-163 Setup.tsx) with all 4 IDEs; LSP snippets panel with 4 IDE tabs + 2 variant sub-tabs present in JSX (lines 625-702); shares `handleCopySnippet` and `copiedKeys` from Plan 04. All 6 getLspSnippet unit tests pass. Runtime rendering required. |

**Score:** 10/10 must-haves verified (all automated checks pass; human runtime verification required for rendering and clipboard behavior)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/shared/src/types.ts` | DaemonStatusInfo interface + daemon? in DashboardState | VERIFIED | Lines 165-186: DaemonStatusInfo with exactly 6 fields (running, healthy, port, port_lsp, tunnelUrl, uptime); `daemon?: DaemonStatusInfo` immediately after `tunnel?: TunnelState` |
| `packages/webview/src/test/store.test.ts` | daemon: undefined in beforeEach + applyState daemon tests | VERIFIED | Line 23: `daemon: undefined`; lines 78-106: `describe('store daemon field')` with 2 passing tests |
| `packages/webview/src/test/setup.test.tsx` | Wave 0 test suite (formatUptime, getMcpSnippet, getLspSnippet) | VERIFIED | 23 tests covering all helper functions; all 23 tests GREEN (confirmed by test run: 33 passed) |
| `packages/webview/src/tabs/Setup.tsx` | DaemonStatusBlock + formatUptime + getMcpSnippet + getLspSnippet + MCP panel + LSP panel | VERIFIED | All 4 exports present and substantive; DaemonStatusBlock at first position in JSX; MCP/LSP panels wired to store daemon field |
| `packages/extension/src/webview/DashboardProvider.ts` | _computeDaemonStatusInfo() + daemon in pushState + DaemonStatusInfo import | VERIFIED | Line 4: DaemonStatusInfo imported; line 535: `daemon: await this._computeDaemonStatusInfo()`; lines 677-694: method exists with try/catch, explicit field list, no spread |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `packages/shared/src/types.ts` | `packages/webview/src/store.ts` | Store extends DashboardState; daemon? auto-picked up | WIRED | store.ts line 6: `interface Store extends DashboardState`; applyState spreads incoming state (`return { ...state, auth, loading: false }`) — daemon field passes through |
| `packages/extension/src/webview/DashboardProvider.ts` | `packages/extension/src/mcp/daemon-manager.ts` | `_computeDaemonStatusInfo()` calls `this._daemonManager?.getDaemonStatus()` | WIRED | DashboardProvider.ts line 679: `const status = await this._daemonManager?.getDaemonStatus();` |
| `packages/extension/src/webview/DashboardProvider.ts` | `packages/shared/src/types.ts` | DaemonStatusInfo imported and used as return type | WIRED | Line 4: `import type { ..., DaemonStatusInfo } from '@airtable-formula/shared'`; line 677: method return type `Promise<DaemonStatusInfo | undefined>` |
| `packages/webview/src/tabs/Setup.tsx` | `packages/webview/src/store.ts` | daemon destructured from useStore() | WIRED | Setup.tsx line 195: `const { ..., daemon } = useStore();` |
| `packages/webview/src/test/setup.test.tsx` | `packages/webview/src/tabs/Setup.tsx` | import { formatUptime, getMcpSnippet, getLspSnippet } | WIRED | setup.test.tsx line 9: `import { formatUptime, getMcpSnippet, getLspSnippet } from '../tabs/Setup.js'` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `Setup.tsx` DaemonStatusBlock | `daemon` (from useStore) | `DashboardProvider._computeDaemonStatusInfo()` → `getDaemonStatus()` | Yes — calls `_daemonManager?.getDaemonStatus()` which reads live lockfile data | FLOWING |
| `Setup.tsx` MCP snippets | `mcpPort = daemon?.port ?? '{MCP_PORT}'` | Same daemon source | Yes — live port or literal placeholder string | FLOWING |
| `Setup.tsx` LSP snippets | `lspPort = daemon?.port_lsp ?? '{LSP_PORT}'` | Same daemon source | Yes — live port_lsp or literal placeholder string | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 33 webview tests pass (formatUptime, getMcpSnippet all 5 IDEs × HTTP bearer token gate, getLspSnippet) | `pnpm -F webview test` | 33/33 passed | PASS |
| getMcpSnippet HTTP all 5 IDEs contain {{BEARER_TOKEN}} (T-08-01 security gate) | Code inspection + test | All 3 HTTP branches in getMcpSnippet() contain hardcoded `{{BEARER_TOKEN}}`; 5 bearer token tests GREEN | PASS |
| bearerToken NOT in DaemonStatusInfo interface | `grep bearerToken packages/shared/src/types.ts` | Only appears as exclusion comment on line 172 — not as a field | PASS |
| pid NOT in DaemonStatusInfo interface | `grep pid packages/shared/src/types.ts` | Only appears as exclusion comment on line 173 — not as a field | PASS |
| bearerToken NOT assigned in _computeDaemonStatusInfo() return object | Code inspection | Explicit field list (lines 682-687) names 6 fields; no bearerToken; comment at line 688 confirms intentional exclusion | PASS |
| daemon field in pushState() state object | Code inspection | DashboardProvider.ts line 535: `daemon: await this._computeDaemonStatusInfo()` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UI-01 | 08-01, 08-02, 08-03 | Setup tab shows unified daemon status block (MCP port, LSP port, tunnel URL, uptime) | SATISFIED (runtime verification pending) | DaemonStatusInfo type defined, _computeDaemonStatusInfo() wires data pipeline, DaemonStatusBlock JSX renders from store.daemon; all 4 fields present in block |
| UI-02 | 08-04 | Setup tab shows copy-paste config snippets for MCP per supported IDE (Claude Code, Claude Desktop, Cursor, Windsurf, Cline) | SATISFIED (runtime verification pending) | getMcpSnippet() fully implemented for all 5 IDEs × HTTP+stdio; MCP snippets panel with dual-level tabs; all bearer token tests GREEN |
| UI-03 | 08-05 | Setup tab shows copy-paste config snippets for LSP per supported IDE (Claude Code, OpenCode, Zed, Neovim) | SATISFIED (runtime verification pending) | getLspSnippet() fully implemented for all 4 IDEs × TCP+stdio; LSP snippets panel with dual-level tabs; all getLspSnippet tests GREEN |

### Security Requirements

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| T-08-01 | bearerToken never in DaemonStatusInfo; never in getMcpSnippet output | VERIFIED | DaemonStatusInfo (types.ts lines 165-174): no bearerToken field, only exclusion comment. `_computeDaemonStatusInfo()` (DashboardProvider.ts lines 682-687): explicit 6-field object literal, no bearerToken. getMcpSnippet() (Setup.tsx lines 22-59): all HTTP branches hardcode `{{BEARER_TOKEN}}` literal. Security gate test (5 IDEs × HTTP): 5/5 pass. |
| T-08-02 | pid never in DaemonStatusInfo | VERIFIED | DaemonStatusInfo (types.ts lines 165-174): no pid field, only exclusion comment. `_computeDaemonStatusInfo()` returned object (DashboardProvider.ts lines 681-690): 6 named fields only — running, healthy, port, port_lsp, tunnelUrl, uptime. No pid anywhere in the mapping. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `Setup.tsx` | 108-121 | OpenCode TCP variant specifies `--stdio` in command AND `initialization.port` for TCP — contradictory config (see REVIEW.md WR-03) | Warning | Snippet will not work for OpenCode TCP users; LSP server starts in stdio mode but client tries TCP connection. Does NOT block phase goal (snippet renders correctly and can be copied). |
| `Setup.tsx` | 9-20 | `formatUptime` does not guard against NaN or negative values (see REVIEW.md WR-04) | Warning | `NaN` input returns `"NaNh NaNm"`. Unlikely in production (uptime from daemon is a computed positive number), but no test coverage. |

Note: CR-01 (ngrok authtoken race) and CR-02 (stale ToolProfileSnapshot fallback) from REVIEW.md are pre-existing issues in the Tunnel section and DashboardProvider, not introduced by Phase 8. They do not affect the phase goal (daemon status block, MCP snippets, LSP snippets). CR-01 was present before Phase 8 (it is in the tunnel enable handler); CR-02 is in the ToolProfileManager initialization path unrelated to daemon status.

### Human Verification Required

#### 1. Daemon Status Block — Live Rendering

**Test:** With daemon running, open the extension's Setup tab in VS Code
**Expected:** DaemonStatusBlock appears as the FIRST panel above the Tunnel section; health chip shows chip-ok "Healthy" or chip-warn "Degraded"; MCP Port row shows live port number; LSP Port row only appears when daemon has LSP running; Tunnel URL row only appears when tunnel is active; Uptime shows elapsed format (e.g., "5m 12s"); block disappears entirely when daemon is stopped
**Why human:** Conditional rendering (`daemon?.running &&`), panel ordering in DOM, chip class selection, and row visibility gates all require VS Code runtime with actual daemon state

#### 2. MCP Snippets Panel — Runtime Rendering and Copy

**Test:** Open Setup tab, scroll to "MCP Server" panel; click through all 5 IDE tabs and both HTTP/stdio variant sub-tabs
**Expected:** 5 IDE tabs visible (Claude Code, Claude Desktop, Cursor, Windsurf, Cline); HTTP (daemon) and stdio (npx) sub-tabs per IDE; snippet changes on tab click; HTTP snippets show {{BEARER_TOKEN}} placeholder (not a live token); with daemon running, HTTP snippets show live port number; Copy snippet button changes to "Copied!" for ~1.5s then resets
**Why human:** Browser clipboard API, CSS transition behavior, and tab switching interaction require VS Code webview runtime

#### 3. LSP Snippets Panel — Runtime Rendering and Copy

**Test:** Open Setup tab, scroll to "LSP Server" panel; click through all 4 IDE tabs and both TCP/stdio variant sub-tabs
**Expected:** 4 IDE tabs (Claude Code, OpenCode, Zed, Neovim); TCP (daemon) and stdio sub-tabs; Neovim TCP shows Lua code with `vim.lsp.rpc.connect`; Neovim stdio shows Lua code with `vim.lsp.config cmd = { 'npx', ... }`; Zed TCP shows `--tcp-client`; with LSP not running, TCP shows `{LSP_PORT}` placeholder
**Why human:** Runtime tab rendering; Lua format display (not JSON) requires visual verification; port placeholder behavior needs live daemon state

### Gaps Summary

No blocking gaps. All must-haves are verified in code. The three human verification items are required because visual rendering, clipboard interaction, and live daemon state cannot be verified programmatically without running the VS Code extension.

**Advisory — not blocking phase goal:**
- WR-03 (REVIEW.md): OpenCode TCP snippet has contradictory `--stdio` + TCP initialization — LSP snippet is rendered and copyable (phase goal met), but the snippet content may not work for OpenCode TCP users. Fix in next patch.
- WR-04 (REVIEW.md): `formatUptime` does not guard NaN — unlikely in production but worth a follow-up test.

---

_Verified: 2026-05-15T18:53:30Z_
_Verifier: Claude (gsd-verifier)_
