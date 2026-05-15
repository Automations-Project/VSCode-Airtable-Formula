# Phase 8: Setup Tab UI - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 8 adds three new UI panels to the existing Setup tab (packages/webview/src/tabs/Setup.tsx):

1. **Daemon Status Block** — Live status panel showing MCP port, LSP port, tunnel URL, and uptime, sourced from daemon lockfile via `DaemonManager.getDaemonStatus()` pushed to `DashboardState`. Hidden entirely when daemon is not running.
2. **MCP Config Snippets** — Per-IDE copy-paste config snippets for 5 IDEs: Claude Code, Claude Desktop, Cursor, Windsurf, Cline. Both HTTP (daemon) and stdio (npx) variants.
3. **LSP Config Snippets** — Per-IDE copy-paste config snippets for 4 IDEs: Claude Code, OpenCode, Zed, Neovim. Both TCP (daemon) and stdio variants.

This phase also adds `daemon?: DaemonStatusInfo` to `DashboardState` (packages/shared/src/types.ts) and populates it in `DashboardProvider.pushState()`.

The extension's language providers, MCP configuration logic, and daemon itself are unchanged.

</domain>

<decisions>
## Implementation Decisions

### D-01: Daemon Status Block — Offline Behavior
- **D-01:** When the daemon is NOT running, hide the status block entirely. No "offline" placeholder. UI-01 specifies the block is "sourced from the running daemon lockfile" — nothing to show if the daemon isn't running.

### D-02: Daemon Status Block — Fields
- **D-02:** The status block displays four fields: MCP port, LSP port (only when non-null — hide the row entirely when `port_lsp` is null), tunnel URL (only when active), and uptime.
- **D-03:** Add a health indicator chip — `chip-ok` for healthy, `chip-warn` for degraded — mapped from `DaemonStatus.healthy` (result of HTTP `/daemon/health` check).
- **D-04:** Uptime display format is at implementer's discretion (elapsed format like "2h 15m" is the natural choice).

### D-05: Daemon Status Block — Placement
- **D-05:** Daemon Status block is the FIRST panel in the Setup tab — above the Tunnel section. Overall tab order: Daemon Status → Tunnel → IDE Configuration → MCP Snippets → LSP Snippets.

### D-06: MCP Config Snippets — Content
- **D-06:** Show BOTH HTTP and stdio variants for every IDE (not daemon-aware switching, not always-npx — always show both so users pick what fits their deployment).
- **D-07:** HTTP snippet uses a `{{BEARER_TOKEN}}` placeholder — the bearer token is sensitive and NOT to be exposed in DashboardState. User fills it in manually.
- **D-08:** Each snippet shows just the server entry block — NOT the full config file wrapper. User pastes into their existing config file.

### D-09: LSP Config Snippets — Content
- **D-09:** Show BOTH TCP (daemon) and stdio variants for every IDE. TCP variant uses `port_lsp` from `DashboardState.daemon.port_lsp`.
- **D-10:** Neovim snippet uses `vim.lsp.config()` API (Neovim 0.11+ native LSP). No nvim-lspconfig.
- **D-11:** Claude Code LSP config format — implementer's discretion. Research current Claude Code LSP config format before implementing.

### D-12: Tab Layout — Snippet Organization
- **D-12:** Within each snippet section (MCP and LSP), organize by tabs per IDE (Claude Code | Claude Desktop | Cursor | …). One tab row = one IDE selector.
- **D-13:** Within each IDE tab, HTTP and stdio variants are shown as nested sub-tabs (HTTP | stdio). User clicks the variant they need.

### Claude's Discretion
- Uptime format — implementer chooses elapsed format (e.g., "2h 15m" or "45m 30s")
- Claude Code LSP config format — implementer researches current format
- Exact CSS styling of snippet code blocks and tab chrome — use existing CSS variables (`var(--font-mono)`, `var(--bg-input)`, `var(--border)`, etc.)
- Whether to use `<pre>` + `<code>` or a styled `<div>` for snippet display

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Setup Tab
- `packages/webview/src/tabs/Setup.tsx` — Current Setup tab — add daemon status block as first panel; MCP and LSP snippet sections go at the bottom

### Shared Types (extend these)
- `packages/shared/src/types.ts` — `DashboardState` — add `daemon?: DaemonStatusInfo` field; `DaemonStatus` is currently extension-only (daemon-manager.ts) and must NOT be imported in shared — define a new lightweight `DaemonStatusInfo` interface
- `packages/shared/src/messages.ts` — WebviewMessage union — no new messages needed (snippets are computed locally from DashboardState)

### Extension — Daemon Integration
- `packages/extension/src/mcp/daemon-manager.ts` — `DaemonStatus` interface and `getDaemonStatus()` — source of truth for port, port_lsp, uptime, healthy
- `packages/extension/src/webview/DashboardProvider.ts` — `pushState()` method (line ~451) — add daemon status population; `_computeTunnelState()` pattern shows how to read lockfile data

### Webview Store
- `packages/webview/src/store.ts` — Zustand store — no new actions needed; `applyState` handles incoming daemon status

### Requirements
- `.planning/REQUIREMENTS.md` — UI-01, UI-02, UI-03 — full requirement text

### Phase Dependencies (read for context)
- `.planning/phases/05-daemon-core/05-CONTEXT.md` — Daemon Core decisions (bearer token, ports)
- `.planning/phases/06-lsp-server/06-CONTEXT.md` — LSP server decisions (port_lsp, attach pattern)
- `.planning/phases/07-tunnel-support/07-CONTEXT.md` — Tunnel decisions (D-02 ngrok authtoken in SecretStorage, D-03 tunnel-settings.json schema)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `glass-panel` CSS class — all sections in Setup.tsx use this; daemon status block and snippet sections should too
- `section-header` pattern with `eyebrow` + `title` + `detail` — established header layout for each panel
- `chip` variants (`chip-ok`, `chip-warn`, `chip-err`, `chip-muted`, `chip-info`) — use for health indicator
- `btn btn-ghost btn-sm` — use for "Copy" buttons in snippets
- Copy-to-clipboard pattern: `navigator.clipboard.writeText()` + state flag with `setTimeout` reset — already in Setup.tsx (`handleCopyUrl`, `setCopiedUrl`)
- `var(--font-mono)` — for snippet code text
- `list-row` — for key-value rows in the daemon status block
- `stack stack-sm` / `stack stack-lg` — for spacing

### Established Patterns
- Zustand store action → `sendToExtension` → extension handler → `pushState()` → `applyState` — existing state push flow; new `daemon` field follows the same push
- Phase 7 added `tunnel?: TunnelState` to `DashboardState` and `_computeTunnelState()` in `DashboardProvider` — the daemon status block follows the same pattern exactly
- `DashboardProvider._daemonManager` is already injected (set in extension.ts) — call `getDaemonStatus()` from there

### Integration Points
- `DashboardProvider.pushState()` (~line 451) — add `daemon: await this._computeDaemonStatusInfo()` to the state object
- `DashboardState` in types.ts — add `daemon?: DaemonStatusInfo` (new lightweight interface, not re-exporting DaemonStatus from daemon-manager.ts which has vscode imports)
- `packages/webview/src/store.ts` — `Store extends DashboardState` — will automatically pick up `daemon` field via spread in `applyState`

</code_context>

<specifics>
## Specific Ideas

- "Show both" HTTP and stdio variants was the explicit choice — not daemon-aware switching. Both snippets are always present so users can pick.
- Nested sub-tabs within each IDE tab (HTTP | stdio for MCP, TCP | stdio for LSP) — compact, avoids long pages
- Tabs-per-IDE layout within each snippet section — one row of IDE selector tabs, code block below
- Daemon status as the very first panel — signals system health before anything else

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 8-setup-tab-ui*
*Context gathered: 2026-05-15*
