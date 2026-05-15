# Phase 8: Setup Tab UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 8-setup-tab-ui
**Areas discussed:** Daemon status block, MCP snippet content, LSP snippet content, Tab layout and placement

---

## Daemon Status Block

| Option | Description | Selected |
|--------|-------------|----------|
| Hide entirely when offline | No daemon panel when daemon is not running | ✓ |
| Show 'offline' state | Grayed out with 'Daemon not running' + Start button | |

**User's choice:** Hide entirely

---

| Option | Description | Selected |
|--------|-------------|----------|
| MCP port | Required field | ✓ |
| LSP port | Required field, hide row when null | ✓ |
| Tunnel URL | Required field, show when active | ✓ |
| Uptime | How long daemon has been running | ✓ |

**User's choice:** All four fields selected

---

| Option | Description | Selected |
|--------|-------------|----------|
| Hide LSP row when null | Only show LSP port when active | ✓ |
| Show '—' placeholder | Always show LSP row with em-dash | |

**User's choice:** Hide the LSP row when port_lsp is null

---

| Option | Description | Selected |
|--------|-------------|----------|
| Elapsed format ("2h 15m") | Computed from uptime ms | |
| Absolute ("Running since HH:MM") | Needs startedAt timestamp | |
| You decide | Implementer's discretion | ✓ |

**User's choice:** You decide

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — health chip | chip-ok / chip-warn mapped from DaemonStatus.healthy | ✓ |
| No | Just port numbers, health implied by block visibility | |

**User's choice:** Yes, include health chip

---

## MCP Snippet Content

| Option | Description | Selected |
|--------|-------------|----------|
| Daemon-aware | Switch npx → HTTP URL when daemon running | |
| Always npx | Universal npx fallback only | |
| Show both | Both HTTP and npx configs always present | ✓ |

**User's choice:** Show both variants

---

| Option | Description | Selected |
|--------|-------------|----------|
| Placeholder only | {{BEARER_TOKEN}} placeholder | ✓ |
| Live token from DashboardState | Expose actual token (currently NOT in DashboardState) | |

**User's choice:** Placeholder only — bearer token is sensitive and intentionally absent from DashboardState

---

| Option | Description | Selected |
|--------|-------------|----------|
| Just the server entry | Only the JSON block that goes inside existing config | ✓ |
| Full example config | Complete file structure for first-timers | |

**User's choice:** Just the server entry block

---

## LSP Snippet Content

| Option | Description | Selected |
|--------|-------------|----------|
| Show both TCP and stdio | Consistent with MCP approach | ✓ |
| Always stdio only | Simpler, works without daemon | |
| You decide | Implementer's discretion | |

**User's choice:** Yes, show both TCP (daemon) and stdio modes

---

| Option | Description | Selected |
|--------|-------------|----------|
| vim.lsp.config | Neovim 0.11+ native LSP | ✓ |
| nvim-lspconfig | Plugin-based, wider adoption | |
| Show both | Both variants | |

**User's choice:** vim.lsp.config (Neovim 0.11+)

---

| Option | Description | Selected |
|--------|-------------|----------|
| You decide | Implementer researches current Claude Code LSP format | ✓ |
| lsp.airtable-user-lsp in .claude/settings.json | Explicit format | |

**User's choice:** You decide — implementer researches current format

---

## Tab Layout and Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Top (first panel) | Before Tunnel — daemon health is most fundamental | ✓ |
| After Tunnel | Keep Phase 7's Tunnel-first order | |
| Below IDE config section | Daemon block at the bottom | |

**User's choice:** Top — Daemon Status first, before Tunnel

---

| Option | Description | Selected |
|--------|-------------|----------|
| Below IDE config | Snippets are reference tool, IDE config is primary action | ✓ |
| Above IDE config | Snippets immediately after daemon | |
| You decide | As long as daemon block is top | |

**User's choice:** Below IDE config section. Final order: Daemon Status → Tunnel → IDE Configuration → MCP Snippets → LSP Snippets

---

| Option | Description | Selected |
|--------|-------------|----------|
| Tabs per IDE | One tab row = one IDE selector. Compact. | ✓ |
| Accordion per IDE | Collapsible rows | |
| Stacked cards | One card per IDE, all visible | |

**User's choice:** Tabs per IDE

---

| Option | Description | Selected |
|--------|-------------|----------|
| Nested sub-tabs (HTTP \| stdio) | Two sub-tabs inside the IDE tab | ✓ |
| Two stacked code blocks | Both snippets in same view with labels | |

**User's choice:** Nested sub-tabs (HTTP | stdio for MCP, TCP | stdio for LSP)

---

## Claude's Discretion

- Uptime display format (elapsed like "2h 15m" is the natural choice)
- Claude Code LSP config format (implementer to research)
- Exact CSS styling of snippet code blocks and tab chrome
- Whether to use `<pre>/<code>` or styled `<div>` for snippet display

## Deferred Ideas

None — discussion stayed within phase scope.
