# Phase 7: Tunnel Support - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 07-tunnel-support
**Areas discussed:** Provider scope, Tunnel lifecycle, 401-burst auto-disable

---

## Provider Scope

| Option | Description | Selected |
|--------|-------------|----------|
| cf-quick only | Cloudflare Quick Tunnel only — zero config, ephemeral URL | |
| cf-quick + ngrok | Two providers with ngrok requiring authtoken setup | ✓ |
| All three (cf-quick + ngrok + cf-named) | Add Cloudflare Named Tunnel with persistent subdomain | ✓ |

**User's choice:** All three providers — cf-quick, ngrok, and cf-named shipped in Phase 7.

**ngrok authtoken storage:**

| Option | Description | Selected |
|--------|-------------|----------|
| VS Code SecretStorage | Stored encrypted in VS Code, passed to daemon in enable-tunnel request body | ✓ |
| ~/.airtable-user-mcp/ngrok.json | File-based, accessible by daemon without extension | |
| Environment variable | NGROK_AUTHTOKEN env var | |

**User's choice:** VS Code SecretStorage — extension reads token and injects into POST /daemon/enable-tunnel body.

**ngrok authtoken entry flow:**

| Option | Description | Selected |
|--------|-------------|----------|
| Setup tab input field | Masked text input in the Setup tab tunnel section | ✓ |
| VS Code input box | `vscode.window.showInputBox()` command palette prompt | |

**User's choice:** Setup tab input field.

**Notes:** cf-named follows Perplexity's `cloudflared-named.ts` pattern exactly — user said details left to planner's discretion.

---

## Tunnel Lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-start on daemon startup | Reads tunnel-settings.json on startup; starts if enabled:true | ✓ |
| Manual start only | User must call enable-tunnel each time daemon starts | |

**User's choice:** Auto-start — daemon reads tunnel-settings.json and restores tunnel state on restart.

**Settings persistence:**

| Option | Description | Selected |
|--------|-------------|----------|
| ~/.airtable-user-mcp/tunnel-settings.json | File-based, daemon-readable without extension | ✓ |
| VS Code settings (airtableFormula.tunnel.*) | Extension-managed, not accessible without VS Code | |
| In daemon.lock | Co-located with daemon state | |

**User's choice:** `~/.airtable-user-mcp/tunnel-settings.json` — single source of truth; daemon works without VS Code open.

**Post-failure behavior:**

| Option | Description | Selected |
|--------|-------------|----------|
| Stay disabled until user re-enables | Write enabled:false; no auto-restart | ✓ |
| Auto-restart with backoff | Exponential backoff, retry up to N times | |
| Auto-restart immediately | Restart on crash, no backoff | |

**User's choice:** Stay disabled — prevents crash loops; user re-enables via Setup tab.

**VS Code command:**

| Option | Description | Selected |
|--------|-------------|----------|
| airtableFormula.tunnel.disable command | Command palette entry to stop tunnel | ✓ |
| No separate command | Setup tab button only | |

**User's choice:** Add `airtableFormula.tunnel.disable` command.

---

## 401-Burst Auto-Disable

**Threshold:**

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded sensible default (10/60s) | BURST_FAILURE_COUNT=10, BURST_WINDOW_MS=60_000 — no VS Code setting | ✓ |
| Configurable VS Code setting | airtableFormula.tunnel.burstThreshold | |

**User's choice:** Hardcoded constants in server.js — no user-facing setting.

**IP logging:**

| Option | Description | Selected |
|--------|-------------|----------|
| Include IP in SSE event | daemon:tunnel-auto-disabled payload includes {failures, windowMs, ip} | ✓ |
| Log failures count only | No IP in event payload | |

**User's choice:** Include IP — Setup tab warning banner shows "Disabled: 10 failures from X.X.X.X in 60s".

**Tunnel admin allowlist:**

| Option | Description | Selected |
|--------|-------------|----------|
| Block /daemon/* from tunnel requests | Middleware returns 404 for admin endpoints from tunnel-originated requests | ✓ |
| All endpoints accessible from tunnel | No allowlist — bearer token is sufficient | |

**User's choice:** Block `/daemon/*` from tunnel — only `/mcp` accessible externally. Follows Perplexity's security model.

---

## Claude's Discretion

- **cf-named login wizard UX details** — Planner follows Perplexity's `cloudflared-named-setup.ts` pattern; no additional specification needed.
- **`airtableFormula.tunnel.enable` command** — Not required; planner can add if it makes implementation cleaner.
- **ngrok optional domain in Setup tab** — "Reserved domain (optional)" input below authtoken field; saves to `tunnel-settings.json` `ngrokDomain` field.
- **`daemon install-tunnel` CLI subcommand** — Add to index.js exports + CLI — installs cloudflared binary.

## Deferred Ideas

- **Rate limiting beyond 401-burst** — per-IP rate limiting, per-UA blocklist (in Perplexity's `createSecurity()`) — Phase 8+ security hardening
- **OAuth 2.1 for multi-user tunnel** — SEC-01 in REQUIREMENTS.md future scope; bearer token sufficient for Phase 7
- **Setup tab comprehensive redesign** — Phase 8 scope (UI-01/02/03); Phase 7 adds focused tunnel section only
- **Tunnel URL as auto-config transport** — Option for IDEs to use tunnel URL as MCP endpoint — UI-02 in Phase 8
