# Phase 08: Setup Tab UI — Research

**Researched:** 2026-05-15
**Domain:** React 19 + custom CSS webview — new UI panels in Setup.tsx + shared-type extension + DashboardProvider wiring
**Confidence:** HIGH

---

## Summary

Phase 8 is an additive UI-only phase. It extends an already-working webview by adding three new panels to `Setup.tsx` and one new type to the shared package. No new routing, no new Zustand actions, no new webview messages, and no changes to the extension's language providers or MCP logic.

The implementation splits cleanly into two work streams: (1) a type + provider wiring task (add `DaemonStatusInfo` to shared types, populate it in `DashboardProvider._computeDaemonStatusInfo()`) and (2) a React component task (daemon status block, MCP snippet section, LSP snippet section all inlined into `Setup.tsx`). The UI-SPEC provides exact JSX structures, copy strings, spacing values, and tab state patterns — the executor can translate these directly without creative decisions.

The highest-risk item is getting the exact config snippet text right for each IDE and variant. Research below documents the verified format for each of the 9 IDE/protocol combinations (5 MCP + 4 LSP). Claude Code LSP uses a plugin-based `.lsp.json` format (NOT a standalone `settings.json` key) — this is the one format that requires a non-obvious decision and is documented in detail below.

**Primary recommendation:** Implement in two sequential tasks — (1) shared types + DashboardProvider wiring, (2) Setup.tsx UI. The second task depends on the first because it reads `daemon` from `useStore()`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** When daemon is NOT running, hide the status block entirely. No offline placeholder.
**D-02:** Status block shows four fields: MCP port always shown; LSP port hidden when `port_lsp` is null; tunnel URL hidden when null; uptime always shown.
**D-03:** Health indicator chip — `chip-ok` for healthy, `chip-warn` for degraded — mapped from `DaemonStatus.healthy`.
**D-04:** Uptime display format at implementer's discretion (elapsed format like "2h 15m" is the natural choice).
**D-05:** Daemon Status block is the FIRST panel — above Tunnel. Final tab order: Daemon Status -> Tunnel -> IDE Configuration -> MCP Snippets -> LSP Snippets.
**D-06:** Show BOTH HTTP and stdio variants for every MCP IDE (always show both — no daemon-aware switching).
**D-07:** HTTP snippet uses literal `{{BEARER_TOKEN}}` placeholder — bearer token NEVER exposed in DashboardState.
**D-08:** Each snippet shows just the server entry block — NOT the full config file wrapper.
**D-09:** Show BOTH TCP (daemon) and stdio variants for every LSP IDE.
**D-10:** Neovim snippet uses `vim.lsp.config()` API (Neovim 0.11+ native LSP). No nvim-lspconfig.
**D-11:** Claude Code LSP config format — implementer's discretion. Research current format before implementing.
**D-12:** Within each snippet section (MCP and LSP), organize by tabs per IDE (one tab row = one IDE selector).
**D-13:** Within each IDE tab, HTTP and stdio variants are shown as nested sub-tabs.

### Claude's Discretion

- Uptime format — implementer chooses elapsed format (e.g., "2h 15m" or "45m 30s")
- Claude Code LSP config format — implementer researches current format
- Exact CSS styling of snippet code blocks and tab chrome — use existing CSS variables
- Whether to use `<pre>` + `<code>` or a styled `<div>` for snippet display

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Setup tab shows unified daemon status block (MCP port, LSP port, tunnel URL, uptime) | DaemonStatus interface verified in daemon-manager.ts; DashboardState extension pattern confirmed via TunnelState model; DaemonStatusInfo interface fully specified in UI-SPEC |
| UI-02 | Setup tab shows copy-paste MCP config snippets per supported IDE (Claude Code, Claude Desktop, Cursor, Windsurf, Cline) | All 5 MCP IDE config formats verified with sources; exact HTTP and stdio entry-block shapes documented below |
| UI-03 | Setup tab shows copy-paste LSP config snippets per supported IDE (Claude Code, OpenCode, Zed, Neovim) | All 4 LSP IDE config formats verified with sources; TCP and stdio variants for each documented below; Claude Code LSP format fully resolved (plugin `.lsp.json` system) |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Daemon status data acquisition | Extension Host | — | Reads daemon.lock file via DaemonManager.getDaemonStatus(); lockfile is on disk, not in browser context |
| Daemon status presentation | Browser / Client (webview) | — | React component renders DaemonStatusInfo from Zustand store |
| Bearer token security | Extension Host | — | Token must never appear in DashboardState; DashboardProvider strips it during _computeDaemonStatusInfo() |
| Snippet text computation | Browser / Client (webview) | — | Pure function of daemon state (port numbers); no extension round-trip needed |
| Tab/variant selection state | Browser / Client (webview) | — | React local state (useState); no persistence required |
| Copy-to-clipboard | Browser / Client (webview) | — | navigator.clipboard.writeText() already used in Setup.tsx |

---

## Standard Stack

### Core (verified in repo)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.0.0 | Component rendering | Project standard — webview package.json [VERIFIED: codebase] |
| Zustand | 5.0.0 | State management | Project standard — store.ts [VERIFIED: codebase] |
| TypeScript | 5.4.0 | Type safety | Project standard [VERIFIED: codebase] |
| Vitest | 1.6.0 | Test runner | Already in webview devDependencies [VERIFIED: codebase] |

No new dependencies are required. Phase 8 adds no npm packages.

---

## Architecture Patterns

### System Architecture Diagram

```
Extension Host                          Webview (React)
─────────────────────────────────       ────────────────────────────────────
DaemonManager.getDaemonStatus()
  └─ reads ~/.airtable-user-mcp/
       daemon.lock (JSON)
  └─ calls /daemon/health HTTP
  └─ returns DaemonStatus
         │
DashboardProvider._computeDaemonStatusInfo()
  └─ strips bearerToken + pid
  └─ returns DaemonStatusInfo
         │
pushState() assembles DashboardState
  └─ daemon: DaemonStatusInfo | undefined
         │
  state:update message ──────────────▶  applyState(state) in store.ts
                                              │
                                         useStore().daemon
                                              │
                                         Setup.tsx renders:
                                         ├── DaemonStatusBlock (if daemon?.running)
                                         ├── [existing Tunnel panel]
                                         ├── [existing IDE panels]
                                         ├── McpSnippetsSection
                                         │   ├── IDE tab bar (5 IDEs)
                                         │   └── variant sub-tabs (HTTP | stdio)
                                         └── LspSnippetsSection
                                             ├── IDE tab bar (4 IDEs)
                                             └── variant sub-tabs (TCP | stdio)
```

### Recommended Project Structure

No new files needed. All changes are additive:

```
packages/shared/src/
├── types.ts           <- add DaemonStatusInfo interface + daemon? field to DashboardState

packages/extension/src/webview/
├── DashboardProvider.ts  <- add _computeDaemonStatusInfo(), add daemon: field to pushState()

packages/webview/src/tabs/
├── Setup.tsx          <- add 3 new panels (daemon status, MCP snippets, LSP snippets)
                          add 4 local state pairs (mcpActiveIde, mcpActiveVariant, etc.)
                          add copiedKeys state + handleCopySnippet()
                          add formatUptime() pure function

packages/webview/src/test/
├── store.test.ts      <- extend: daemon field in applyState + formatUptime tests
├── setup.test.tsx     <- NEW: snippet content + daemon block visibility tests (Wave 0 gap)
```

### Pattern 1: DaemonStatusInfo — Strip Sensitive Fields Before Webview

**What:** Map `DaemonStatus` (extension-private) to `DaemonStatusInfo` (shared/webview-safe) by dropping `bearerToken` and `pid`.
**When to use:** Any time extension-internal data must be shared with the webview.

```typescript
// Source: daemon-manager.ts (verified in codebase)
// DaemonStatus (extension-only, has bearerToken):
export interface DaemonStatus {
  running: boolean; healthy: boolean; pid: number | null;
  port: number | null; port_lsp: number | null;
  bearerToken: string | null; tunnelUrl: string | null; uptime: number | null;
}

// DaemonStatusInfo (shared, webview-safe — add to packages/shared/src/types.ts):
export interface DaemonStatusInfo {
  running:   boolean;
  healthy:   boolean;
  port:      number | null;
  port_lsp:  number | null;
  tunnelUrl: string | null;
  uptime:    number | null;   // milliseconds elapsed since daemon start, or null
}
```

```typescript
// Source: _computeTunnelState() pattern in DashboardProvider.ts (verified in codebase)
// _computeDaemonStatusInfo() follows the same async private method pattern:
private async _computeDaemonStatusInfo(): Promise<DaemonStatusInfo | undefined> {
  try {
    const status = await this._daemonManager?.getDaemonStatus();
    if (!status?.running) return undefined;
    return {
      running: status.running,
      healthy: status.healthy,
      port: status.port,
      port_lsp: status.port_lsp,
      tunnelUrl: status.tunnelUrl,
      uptime: status.uptime,
    };
    // bearerToken and pid intentionally excluded (D-07)
  } catch {
    return undefined;
  }
}
```

### Pattern 2: Dual-Level Tab State — Independent State Pairs

**What:** Two independent `useState` pairs — one for MCP section, one for LSP section. Outer tab = IDE selector; inner tab = variant selector.
**When to use:** When two tab groups must not interfere with each other.

```typescript
// Source: UI-SPEC interaction contracts (verified in 08-UI-SPEC.md)
const [mcpActiveIde, setMcpActiveIde] = React.useState('claude-code');
const [mcpActiveVariant, setMcpActiveVariant] = React.useState<'http' | 'stdio'>('http');
const [lspActiveIde, setLspActiveIde] = React.useState('claude-code');
const [lspActiveVariant, setLspActiveVariant] = React.useState<'tcp' | 'stdio'>('tcp');
```

### Pattern 3: Copy Key Format — Unique Per Snippet Target

**What:** Shared `copiedKeys` Record<string, boolean> — single state map for all copy buttons.
**Key format:** `{section}-{ide}-{variant}` e.g., `mcp-claude-code-http`, `lsp-neovim-tcp`.

```typescript
// Source: UI-SPEC interaction contracts (verified in 08-UI-SPEC.md)
const [copiedKeys, setCopiedKeys] = React.useState<Record<string, boolean>>({});
const handleCopySnippet = (text: string, key: string) => {
  navigator.clipboard.writeText(text).catch(() => undefined);
  setCopiedKeys(k => ({ ...k, [key]: true }));
  setTimeout(() => setCopiedKeys(k => ({ ...k, [key]: false })), 1500);
};
```

### Pattern 4: Snippet Content — Inline Computation, No Round-Trip

**What:** Port values read from `useStore().daemon`; snippet strings composed inline in JSX render.
**When to use:** Deterministic data from existing store state — no async, no extension message.

```typescript
// Source: UI-SPEC (verified in 08-UI-SPEC.md)
const { daemon } = useStore();
const mcpPort = daemon?.port ?? '{MCP_PORT}';
const lspPort = daemon?.port_lsp ?? '{LSP_PORT}';
```

### Pattern 5: formatUptime — Pure Function

```typescript
// Source: UI-SPEC component spec (verified in 08-UI-SPEC.md)
function formatUptime(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return '< 1m';
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}
```

### Anti-Patterns to Avoid

- **Importing vscode-dependent types in shared package:** `DaemonStatus` lives in `daemon-manager.ts` which imports `vscode`. It cannot appear in `packages/shared/src/types.ts`. Define `DaemonStatusInfo` as a new standalone interface.
- **Passing bearerToken in DashboardState:** D-07 is an absolute prohibition. `_computeDaemonStatusInfo()` must explicitly exclude `bearerToken`.
- **New Zustand actions for snippet display:** Snippet text is deterministic from existing state. No `action:getSnippet` or round-trip needed.
- **New WebviewMessage types:** CONTEXT.md explicitly confirms no new messages are needed for this phase.
- **Full config file wrappers in snippets:** D-08 specifies entry blocks only. The user pastes into their existing config file.
- **Using innerHtml for snippet rendering:** Always use `<pre><code>{snippetText}</code></pre>` so React escapes the content safely.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Copy to clipboard | Custom clipboard API shim | `navigator.clipboard.writeText()` | Already used in Setup.tsx; webview context supports it |
| Tab component | Third-party tab library | Inline `<button>` + useState | UI-SPEC mandates no external libraries; existing App.tsx tab pattern works perfectly |
| Uptime formatting | Date-fns or moment | `formatUptime()` pure function (10 lines) | Trivial computation with fixed format — no library overhead |

---

## MCP Config Snippet Formats

All 5 MCP IDE formats verified. Each snippet shows only the **server entry block** (D-08) — not the full file wrapper.

### Claude Code — MCP

**Config file:** `~/.claude.json` under `mcpServers` key [VERIFIED: ide-configs.ts in codebase]

HTTP (daemon) entry block:
```json
"airtable": {
  "type": "http",
  "url": "http://127.0.0.1:{port}/mcp",
  "headers": {
    "Authorization": "Bearer {{BEARER_TOKEN}}"
  }
}
```
[CITED: https://code.claude.com/docs/en/mcp]

stdio (npx) entry block:
```json
"airtable": {
  "command": "npx",
  "args": ["-y", "airtable-user-mcp"]
}
```
[CITED: https://code.claude.com/docs/en/mcp]

### Claude Desktop — MCP

**Config file:** `%APPDATA%\Claude\claude_desktop_config.json` (Windows) [VERIFIED: ide-configs.ts in codebase]

HTTP (daemon) entry block:
```json
"airtable": {
  "type": "http",
  "url": "http://127.0.0.1:{port}/mcp",
  "headers": {
    "Authorization": "Bearer {{BEARER_TOKEN}}"
  }
}
```
[ASSUMED — Claude Desktop HTTP support assumed same format as Claude Code; verify against latest Claude Desktop release notes before shipping]

stdio (npx) entry block:
```json
"airtable": {
  "command": "npx",
  "args": ["-y", "airtable-user-mcp"]
}
```
[CITED: https://gofastmcp.com/integrations/mcp-json-configuration]

### Cursor — MCP

**Config file:** `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project) [VERIFIED: ide-configs.ts uses `~/.cursor/mcp.json`]

HTTP (daemon) entry block:
```json
"airtable": {
  "url": "http://127.0.0.1:{port}/mcp",
  "headers": {
    "Authorization": "Bearer {{BEARER_TOKEN}}"
  }
}
```
Note: Cursor uses `url` (not `type: "http"`) for HTTP servers.
[CITED: https://cursor.com/docs/mcp.md via web search]

stdio (npx) entry block:
```json
"airtable": {
  "command": "npx",
  "args": ["-y", "airtable-user-mcp"]
}
```
[CITED: https://cursor.com/docs/mcp.md via web search]

### Windsurf — MCP

**Config file:** `~/.codeium/windsurf/mcp_config.json` [VERIFIED: ide-configs.ts in codebase]

HTTP (daemon) entry block:
```json
"airtable": {
  "serverUrl": "http://127.0.0.1:{port}/mcp",
  "headers": {
    "Authorization": "Bearer {{BEARER_TOKEN}}"
  }
}
```
Note: Windsurf uses `serverUrl` (not `url`). Both are accepted but `serverUrl` is the documented key.
[CITED: https://docs.windsurf.com/windsurf/cascade/mcp]

stdio (npx) entry block:
```json
"airtable": {
  "command": "npx",
  "args": ["-y", "airtable-user-mcp"]
}
```
[CITED: https://docs.windsurf.com/windsurf/cascade/mcp]

### Cline — MCP

**Config file:** `~/.cline/data/settings/cline_mcp_settings.json` [VERIFIED: ide-configs.ts in codebase]

HTTP (daemon) entry block:
```json
"airtable": {
  "url": "http://127.0.0.1:{port}/mcp",
  "headers": {
    "Authorization": "Bearer {{BEARER_TOKEN}}"
  }
}
```
[CITED: https://docs.cline.bot/mcp/configuring-mcp-servers]

stdio (npx) entry block:
```json
"airtable": {
  "command": "npx",
  "args": ["-y", "airtable-user-mcp"]
}
```
[CITED: https://docs.cline.bot/mcp/configuring-mcp-servers]

---

## LSP Config Snippet Formats

All 4 LSP IDE formats verified. Each snippet shows the config block the user adds to their editor config.

### Claude Code — LSP

**Critical finding (D-11 resolution):** Claude Code's LSP support is plugin-based, not a `settings.json` key. Users add a `.lsp.json` file to their plugin directory. There is no top-level `lsp:` key in `~/.claude/settings.json` for arbitrary custom servers.
[VERIFIED: https://code.claude.com/docs/en/plugins-reference]

**Config file:** `.lsp.json` in a Claude Code plugin directory.

stdio variant (recommended — fully verified):
```json
{
  "airtable-formula": {
    "command": "npx",
    "args": ["-y", "airtable-user-lsp", "--stdio"],
    "extensionToLanguage": {
      ".formula": "airtable-formula",
      ".ats": "airtable-script",
      ".ata": "airtable-automation"
    }
  }
}
```
[CITED: https://code.claude.com/docs/en/plugins-reference — verified `command`, `args`, `extensionToLanguage` fields]

TCP (daemon) variant — `transport: "socket"` (partially verified):
```json
{
  "airtable-formula": {
    "command": "npx",
    "args": ["-y", "airtable-user-lsp", "--stdio"],
    "transport": "socket",
    "extensionToLanguage": {
      ".formula": "airtable-formula",
      ".ats": "airtable-script",
      ".ata": "airtable-automation"
    }
  }
}
```
[ASSUMED — Claude Code plugin LSP docs list `transport: "socket"` as an option but do not specify what parameters (host/port) socket transport uses. See Open Question #3. Executor must verify before finalizing; fall back to stdio-only if socket transport parameters are not documented.]

### OpenCode — LSP

**Config file:** `opencode.json` in project root or user config
[CITED: https://opencode.ai/docs/lsp/]

stdio variant (verified):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "airtable-formula": {
      "command": ["npx", "-y", "airtable-user-lsp", "--stdio"],
      "extensions": [".formula", ".ats", ".ata"]
    }
  }
}
```
[CITED: https://opencode.ai/docs/lsp/ — verified `lsp` key, `command` array, `extensions` array]

TCP (daemon) variant:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "airtable-formula": {
      "command": ["npx", "-y", "airtable-user-lsp", "--stdio"],
      "extensions": [".formula", ".ats", ".ata"],
      "initialization": {
        "host": "127.0.0.1",
        "port": "{lspPort}"
      }
    }
  }
}
```
[ASSUMED — OpenCode docs document `initialization` as an optional object for initialization options; whether this enables true TCP attach vs always spawning a subprocess is unclear. See Open Question #1.]

### Zed — LSP

**Config file:** `~/.config/zed/settings.json` (global)
[CITED: https://zed.dev/docs/configuring-languages]

stdio variant:
```json
{
  "lsp": {
    "airtable-formula": {
      "binary": {
        "path": "airtable-user-lsp",
        "arguments": ["--stdio"]
      }
    }
  }
}
```
[CITED: https://zed.dev/docs/configuring-languages — verified `lsp.{name}.binary.path` and `binary.arguments` fields]

TCP (daemon) variant:
```json
{
  "lsp": {
    "airtable-formula": {
      "binary": {
        "path": "airtable-user-lsp",
        "arguments": ["--tcp-client", "127.0.0.1:{lspPort}"]
      }
    }
  }
}
```
[ASSUMED — Zed `lsp.{name}.binary` format is verified. However, Zed currently requires a Zed extension (WASM) for custom language servers not already registered; a standalone `lsp` entry for an unknown language ID may not activate. See Open Question #2.]

### Neovim — LSP

**Config file:** User's Neovim config (e.g., `~/.config/nvim/init.lua`)
**API:** `vim.lsp.config()` + `vim.lsp.enable()` (Neovim 0.11+ native LSP — D-10)
[CITED: https://neovim.io/doc/user/lsp.html]

TCP (daemon) variant using `vim.lsp.rpc.connect()`:
```lua
vim.lsp.config('airtable_formula', {
  cmd = vim.lsp.rpc.connect('127.0.0.1', {lspPort}),
  filetypes = { 'formula', 'airtable-script', 'airtable-automation' },
  root_markers = { '.git' },
})
vim.lsp.enable('airtable_formula')
```
[CITED: https://neovim.io/doc/user/lsp.html — `vim.lsp.rpc.connect()` is the documented TCP connection factory; confirmed via Neovim Discourse for TCP LSP pattern]

stdio variant:
```lua
vim.lsp.config('airtable_formula', {
  cmd = { 'npx', '-y', 'airtable-user-lsp', '--stdio' },
  filetypes = { 'formula', 'airtable-script', 'airtable-automation' },
  root_markers = { '.git' },
})
vim.lsp.enable('airtable_formula')
```
[CITED: https://blog.diovani.com/technology/2025/06/13/configuring-neovim-011-lsp.html — verified `cmd`, `filetypes`, `root_markers` fields]

---

## Common Pitfalls

### Pitfall 1: Importing vscode-dependent Types in Shared Package

**What goes wrong:** A developer imports `DaemonStatus` from `daemon-manager.ts` into `packages/shared/src/types.ts`, causing the build to fail because shared is an ESM package without VS Code as a dependency.
**Why it happens:** `DaemonStatus` already has all the fields needed and it is tempting to re-export it.
**How to avoid:** Define `DaemonStatusInfo` as a new standalone interface in types.ts. Copy only the safe fields. Never import from `packages/extension` in `packages/shared`.
**Warning signs:** TypeScript error mentioning `vscode` module not found in shared build.

### Pitfall 2: Snippet Text Using Wrong HTTP Key Per IDE

**What goes wrong:** Using `"type": "http"` for Cursor/Cline (which use `"url"` only), or using `"url"` for Windsurf (which expects `"serverUrl"`).
**Why it happens:** The MCP spec does not mandate a single key; each IDE implemented slightly differently.
**How to avoid:** Use the per-IDE key names documented in the Standard Formats section above. Cursor and Cline: `url`. Windsurf: `serverUrl`. Claude Code/Desktop: `type: "http"` + `url`.
**Warning signs:** User reports the HTTP server not being recognized in that IDE.

### Pitfall 3: Rendering Snippet Block When Daemon is Absent (Port Placeholder)

**What goes wrong:** The snippet sections are always rendered (correct per D-01) but the port in the HTTP snippet shows `undefined` instead of `'{MCP_PORT}'` when the daemon is not running.
**Why it happens:** Forgetting the nullish coalescing fallback for `daemon?.port`.
**How to avoid:** Always compute `const mcpPort = daemon?.port ?? '{MCP_PORT}'` before using the port value in snippet strings.
**Warning signs:** HTTP snippet shows `"url": "http://127.0.0.1:undefined/mcp"`.

### Pitfall 4: Copy Button Positioned Outside `position: relative` Container

**What goes wrong:** `position: absolute` copy button jumps to a wrong location on the page.
**Why it happens:** Forgetting to set `position: 'relative'` on the `<div>` wrapping the `<pre>` block.
**How to avoid:** Always wrap `<pre>` in `<div style={{ position: 'relative' }}>`.
**Warning signs:** Copy button appears at the top-left of the panel or outside the code block.

### Pitfall 5: Store Test Breaks on New daemon Field

**What goes wrong:** The existing `store.test.ts` `applyState` test fails because it passes a state object without the `daemon` field and the test's `beforeEach` reset does not include `daemon: undefined`.
**Why it happens:** The `applyState` test uses a hardcoded state object — adding `daemon` to `DashboardState` does not break applyState behavior (it uses spread) but the reset needs updating.
**How to avoid:** Update the `beforeEach` state reset in store.test.ts to include `daemon: undefined`.
**Warning signs:** TypeScript errors in store.test.ts after DashboardState gains the `daemon?` field.

### Pitfall 6: Claude Code LSP — Assuming a Simple settings.json Key

**What goes wrong:** The LSP snippet for Claude Code uses `~/.claude/settings.json` with a top-level `lsp:` key, but Claude Code does not support this. It uses a plugin-based `.lsp.json` system.
**Why it happens:** Training data may conflate Claude Code with other editors that have a simple settings-file LSP config.
**How to avoid:** Use the `.lsp.json` plugin format documented above. The snippet text should note that users add it inside a plugin directory.
**Warning signs:** Users report Claude Code does not recognize the LSP server.

---

## Code Examples

### DashboardState Extension

```typescript
// Source: packages/shared/src/types.ts — add after TunnelState definition
export interface DaemonStatusInfo {
  running:   boolean;
  healthy:   boolean;
  port:      number | null;
  port_lsp:  number | null;
  tunnelUrl: string | null;
  uptime:    number | null;
}

// In DashboardState (after tunnel? field):
daemon?: DaemonStatusInfo;
```

### DashboardProvider Integration Point

```typescript
// Source: DashboardProvider.ts pushState() — verified at line 534-535 in codebase
// Add to state object (after tunnel):
daemon: await this._computeDaemonStatusInfo(),

// New private method (follows _computeTunnelState() pattern):
private async _computeDaemonStatusInfo(): Promise<DaemonStatusInfo | undefined> {
  try {
    const status = await this._daemonManager?.getDaemonStatus();
    if (!status?.running) return undefined;
    return {
      running: status.running,
      healthy: status.healthy,
      port: status.port,
      port_lsp: status.port_lsp,
      tunnelUrl: status.tunnelUrl,
      uptime: status.uptime,
    };
  } catch {
    return undefined;
  }
}
```

### Daemon Status Block — Visibility Guard

```tsx
// Source: 08-UI-SPEC.md component spec
{daemon?.running && (
  <div className="glass-panel">
    {/* ... daemon status content ... */}
  </div>
)}
```

### Outer IDE Tab Bar (verified App.tsx pattern)

```tsx
// Source: 08-UI-SPEC.md — matches App.tsx tab navigation pattern in codebase
<div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
  {IDE_TABS.map(ide => (
    <button
      key={ide.id}
      role="tab"
      aria-selected={mcpActiveIde === ide.id}
      onClick={() => setMcpActiveIde(ide.id)}
      style={{
        padding: '8px 12px',
        fontSize: '0.7rem',
        fontWeight: mcpActiveIde === ide.id ? 600 : 500,
        color: mcpActiveIde === ide.id ? 'var(--fg)' : 'var(--fg-muted)',
        borderBottom: `2px solid ${mcpActiveIde === ide.id ? 'var(--at-blue)' : 'transparent'}`,
        background: 'none', border: 'none', borderBottomStyle: 'solid',
        borderBottomWidth: 2, cursor: 'pointer',
        transition: 'color 120ms ease, border-color 120ms ease',
      }}
    >{ide.label}</button>
  ))}
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Claude Code: arbitrary `settings.json` lsp key | Claude Code: plugin-based `.lsp.json` system | Dec 2025 (LSP plugin release) | LSP snippets for Claude Code must use the plugin format, not a simple settings key |
| Neovim: nvim-lspconfig for all LSP setup | Neovim 0.11+: `vim.lsp.config()` / `vim.lsp.enable()` native API | Neovim 0.11 (released 2025) | D-10 is correct — use native API, not nvim-lspconfig |
| Windsurf: `url` field for HTTP MCP | Windsurf: `serverUrl` field preferred | — | Windsurf snippets must use `serverUrl` not `url` |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Claude Desktop supports `type: "http"` MCP entries (same format as Claude Code) | MCP Snippets — Claude Desktop | HTTP snippet for Claude Desktop would not work; fallback is stdio variant which is verified |
| A2 | Claude Code plugin LSP `transport: "socket"` connects to an existing TCP port using parameters not yet verified | LSP Snippets — Claude Code TCP | TCP snippet for Claude Code would be wrong; executor must verify before writing final snippet; stdio variant is fallback |
| A3 | OpenCode LSP TCP variant is achievable via `initialization` options | LSP Snippets — OpenCode TCP | OpenCode may not support true TCP LSP attach; stdio variant is verified and functional |
| A4 | Zed `lsp.{name}.binary` settings work for completely custom (unregistered) language servers without a Zed extension | LSP Snippets — Zed | Zed may silently ignore config for unknown language IDs; user may need to install a Zed extension for full support |

---

## Open Questions

1. **OpenCode LSP TCP transport**
   - What we know: OpenCode `opencode.json` supports `lsp.{name}.command`, `extensions`, `initialization`
   - What is unclear: Whether OpenCode's LSP client can connect to an existing TCP port vs always spawning a subprocess via `command`
   - Recommendation: Executor should check the OpenCode LSP docs before finalizing TCP snippet. If TCP attach is not supported, show only the stdio variant for OpenCode or annotate the TCP tab.

2. **Zed custom LSP without extension**
   - What we know: Zed `lsp.{name}.binary` overrides the binary for a known language server
   - What is unclear: Whether Zed will activate a completely new language server for `.formula` files without a Zed extension that registers the language ID and file associations
   - Recommendation: Snippet should include a comment that Zed requires a Zed extension for full `.formula` file support.

3. **Claude Code LSP TCP socket parameters**
   - What we know: Claude Code plugin `.lsp.json` supports `transport: "socket"` (documented field)
   - What is unclear: Whether the socket transport connects to an existing TCP port, and what parameters it accepts
   - Recommendation: Executor fetches the Claude Code plugin creation docs before writing the TCP snippet. The stdio variant is fully verified and should be the primary recommendation if socket TCP is not clearly documented.

---

## Environment Availability

Step 2.6: SKIPPED (no external runtime dependencies — this phase is pure TypeScript/React code changes to existing packages; no new CLI tools, databases, or services required).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 1.6.0 |
| Config file | `vite.config.ts` (vitest uses Vite config; no separate vitest.config.ts needed) |
| Quick run command | `pnpm -F webview vitest run` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | `applyState` with daemon field populates store correctly | unit | `pnpm -F webview vitest run -t "daemon"` | ❌ Wave 0 (extend store.test.ts) |
| UI-01 | `formatUptime()` returns correct strings for null / less than 1m / minutes / hours | unit | `pnpm -F webview vitest run -t "formatUptime"` | ❌ Wave 0 |
| UI-01 | Daemon status block hidden when `daemon?.running` is false/undefined | unit (component) | `pnpm -F webview vitest run -t "DaemonStatusBlock"` | ❌ Wave 0 |
| UI-01 | LSP port row hidden when `port_lsp` is null | unit (component) | `pnpm -F webview vitest run -t "lsp port row"` | ❌ Wave 0 |
| UI-02 | MCP snippet HTTP text contains `{{BEARER_TOKEN}}` placeholder (never a real token) | unit | `pnpm -F webview vitest run -t "bearer token"` | ❌ Wave 0 |
| UI-02 | MCP snippet HTTP uses live port when daemon running, placeholder when not | unit | `pnpm -F webview vitest run -t "mcp port"` | ❌ Wave 0 |
| UI-03 | LSP snippet TCP uses live `port_lsp` when available, placeholder when not | unit | `pnpm -F webview vitest run -t "lsp port snippet"` | ❌ Wave 0 |
| UI-02 + UI-03 | Copy button sets copiedKeys state; resets after 1500ms | unit | `pnpm -F webview vitest run -t "copy"` | ❌ Wave 0 |
| UI-01 | `_computeDaemonStatusInfo()` strips bearerToken and pid from DaemonStatus | manual (extension host) | inspect DashboardState.daemon in devtools | manual only |

### Test Approach

**Unit tests only** (no visual or e2e tests for this phase). All new tests go in `packages/webview/src/test/`.

Two test files:

1. **Extend `store.test.ts`:** Add `daemon: undefined` to the `beforeEach` reset; add test for `applyState` with `daemon` present; add `formatUptime` pure function tests (import the function directly from Setup.tsx or extract to a utils module).

2. **New `setup.test.tsx`:** Test snippet text generation as pure functions (extract `getMcpSnippet(ide, variant, port)` and `getLspSnippet(ide, variant, port)` from the component, or test them via snapshot). Test daemon block visibility. The existing test style in this project does NOT use `@testing-library/react` — keep tests at the pure-function/store level to match.

Note: `@testing-library/react` is NOT currently in webview devDependencies. If component-level DOM testing is needed, add it. Otherwise keep all new tests at the pure-function level.

### Sampling Rate

- **Per task commit:** `pnpm -F webview vitest run`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/webview/src/test/store.test.ts` — extend with daemon applyState test + formatUptime tests
- [ ] `packages/webview/src/test/setup.test.tsx` — new file covering snippet content assertions and daemon block visibility logic
- [ ] Decision: extract `formatUptime`, `getMcpSnippet`, `getLspSnippet` as named exports from Setup.tsx (or a sibling utils file) so they can be unit-tested without rendering the full component

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | Snippet content is composed from static strings + numeric port values from trusted extension state; no user input flows into snippet text |
| V6 Cryptography | no | — |

### Phase-Specific Security Controls

| Control | Implementation |
|---------|----------------|
| Bearer token exclusion (D-07) | `_computeDaemonStatusInfo()` must explicitly omit `bearerToken`; `DaemonStatusInfo` interface must not have a `bearerToken` field |
| No sensitive state in snippets | HTTP snippet uses literal `{{BEARER_TOKEN}}` string; port values are non-sensitive numeric data |
| Safe content rendering | Snippet text rendered inside React JSX with `<pre><code>{text}</code></pre>` — React escapes string content automatically |

---

## Sources

### Primary (HIGH confidence)

- Codebase: `packages/extension/src/mcp/daemon-manager.ts` — DaemonStatus interface (source of truth for port/uptime/healthy fields) [VERIFIED: codebase]
- Codebase: `packages/extension/src/webview/DashboardProvider.ts` — `_computeTunnelState()` pattern for `_computeDaemonStatusInfo()` [VERIFIED: codebase]
- Codebase: `packages/shared/src/types.ts` — DashboardState shape and TunnelState insertion pattern [VERIFIED: codebase]
- Codebase: `packages/webview/src/tabs/Setup.tsx` — current component structure; all existing CSS class usage [VERIFIED: codebase]
- Codebase: `packages/webview/src/store.ts` — applyState pattern, no new actions needed [VERIFIED: codebase]
- Codebase: `packages/webview/src/styles.css` — full CSS design system verified [VERIFIED: codebase]
- Codebase: `packages/extension/src/auto-config/ide-configs.ts` — verified config file paths for all 5 MCP IDEs [VERIFIED: codebase]
- `.planning/phases/08-setup-tab-ui/08-UI-SPEC.md` — approved visual contract (all JSX structures, spacing, copy strings) [VERIFIED: codebase]
- `.planning/phases/08-setup-tab-ui/08-CONTEXT.md` — all locked decisions [VERIFIED: codebase]
- `code.claude.com/docs/en/plugins-reference` — Claude Code LSP plugin `.lsp.json` format [CITED]
- `code.claude.com/docs/en/mcp` — Claude Code MCP HTTP and stdio format [CITED]
- `opencode.ai/docs/lsp/` — OpenCode LSP config format [CITED]
- `zed.dev/docs/configuring-languages` — Zed `lsp.{name}.binary` format [CITED]
- `neovim.io/doc/user/lsp.html` + blog.diovani.com — `vim.lsp.rpc.connect()` TCP pattern and `vim.lsp.config()` API [CITED]

### Secondary (MEDIUM confidence)

- `docs.windsurf.com/windsurf/cascade/mcp` — Windsurf `serverUrl` key confirmed [CITED]
- `docs.cline.bot/mcp/configuring-mcp-servers` — Cline `url` + `headers` format confirmed [CITED]
- `cursor.com/docs/mcp.md` (via web search) — Cursor `url` key for HTTP [CITED]

### Tertiary (LOW confidence / ASSUMED)

- Claude Desktop HTTP MCP format (A1) — assumed same as Claude Code; not independently verified against Claude Desktop release notes
- OpenCode TCP LSP variant (A3) — assumed via `initialization` field; not verified against live OpenCode implementation
- Zed custom server without extension (A4) — based on GitHub discussions showing limitation; official docs do not explicitly state this
- Claude Code LSP TCP socket parameters (A2) — `transport: "socket"` documented but connection parameters unverified

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in codebase
- Architecture: HIGH — patterns directly visible in DashboardProvider.ts and store.ts
- MCP snippet formats: MEDIUM-HIGH — 4 of 5 IDEs cited from official docs; Claude Desktop assumed
- LSP snippet formats: MEDIUM — stdio variants cited; TCP variants partially assumed (especially OpenCode and Zed)
- Pitfalls: HIGH — all derived from direct code inspection

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (30 days; MCP config formats are stable; Claude Code LSP plugin API may evolve)
