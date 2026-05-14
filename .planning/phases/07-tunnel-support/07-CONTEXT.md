# Phase 7: Tunnel Support - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Add tunnel support to the daemon so the local MCP server can be exposed to remote AI clients via a public HTTPS URL. Phase 7 delivers:
- Three tunnel providers: Cloudflare Quick (cf-quick), ngrok, Cloudflare Named (cf-named)
- Daemon-side tunnel lifecycle (start/stop/auto-disable on 401-burst)
- `~/.airtable-user-mcp/tunnel-settings.json` for persisted provider choice + enabled state
- VS Code Setup tab UI with Enable/Disable button, tunnel URL display, provider picker, ngrok authtoken field, and 401-burst warning banner
- VS Code command `airtableFormula.tunnel.disable`
- Tunnel admin allowlist middleware (block `/daemon/*` from tunnel requests)

The VS Code extension's language providers and MCP configuration are unchanged.
</domain>

<decisions>
## Implementation Decisions

### D-01: Provider Scope — Three Providers

**Decision:** Ship all three tunnel providers in Phase 7:
- **`cf-quick`** — Cloudflare Quick Tunnel. Zero config, ephemeral `*.trycloudflare.com` URL. Binary installed via `daemon install-tunnel`. Provider follows Perplexity's `cloudflared-quick.ts`.
- **`ngrok`** — ngrok. Requires authtoken + optional reserved domain. Uses `@ngrok/ngrok` NAPI binding (lazy-loaded, optional dep). Provider follows Perplexity's `ngrok.ts` + `ngrok-config.ts`.
- **`cf-named`** — Cloudflare Named Tunnel. Requires cloudflared login + DNS setup. Provider follows Perplexity's `cloudflared-named.ts` + `cloudflared-named-setup.ts`. Setup wizard handled by extension.

All three providers ported from `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\` with Airtable-specific renames.

---

### D-02: ngrok Authtoken — VS Code SecretStorage + Setup Tab Input

**Decision:** ngrok authtoken is stored in VS Code SecretStorage (not file-based).

**Entry flow:** When ngrok is selected as provider in the Setup tab and no authtoken is set, the Setup tab shows a masked text input field. User pastes their authtoken there. Webview sends a typed message to the extension, which stores the token in `SecretStorage`.

**Daemon integration:** The extension reads the authtoken from SecretStorage and passes it in the `POST /daemon/enable-tunnel` request body: `{ provider: 'ngrok', authtoken: '...', domain?: '...' }`. The daemon receives it and passes it directly to the ngrok provider's `start()` call. The authtoken is never written to disk by the daemon.

---

### D-03: Tunnel Settings Persistence — ~/.airtable-user-mcp/tunnel-settings.json

**Decision:** Tunnel enabled state and provider choice persist in `~/.airtable-user-mcp/tunnel-settings.json`.

**Schema:**
```json
{
  "enabled": true,
  "provider": "cf-quick",
  "ngrokDomain": null
}
```

- `enabled`: Whether to auto-start the tunnel on daemon startup.
- `provider`: Active provider ID (`"cf-quick"` | `"ngrok"` | `"cf-named"`).
- `ngrokDomain`: Optional ngrok reserved domain (e.g. `"yourname.ngrok-free.app"`); null → ephemeral URL.

The daemon reads this file on startup. The extension reads it to display current state in the Setup tab. `airtableFormula.tunnel.provider` VS Code setting is NOT used — settings file is the single source of truth (allows daemon to work without VS Code open).

---

### D-04: Tunnel Lifecycle — Auto-Start + Stay Disabled on Failure

**Decision:**

**Auto-start on daemon startup:** After `startDaemonServer()` succeeds, `startDaemon()` reads `tunnel-settings.json`. If `enabled: true` and the provider is configured (binary exists / authtoken present), the daemon starts the tunnel automatically. The `tunnelUrl` field in the lockfile is set once the tunnel publishes a URL.

**On auto-disable or crash:** The daemon writes `enabled: false` to `tunnel-settings.json` and clears `tunnelUrl` in the lockfile. The user must explicitly re-enable the tunnel via the Setup tab or the `airtableFormula.tunnel.disable` command.

**No auto-restart backoff** — tunnel stays disabled after any failure until user re-enables. Prevents crash-restart loops.

---

### D-05: VS Code Command — airtableFormula.tunnel.disable

**Decision:** Add `airtableFormula.tunnel.disable` command to `packages/extension/package.json`.

**Behavior:** Calls `POST /daemon/disable-tunnel`, writes `enabled: false` to `tunnel-settings.json`, clears `tunnelUrl` from lockfile. Useful for making the server loopback-only without restarting the daemon.

**Note:** Enable is handled via the Setup tab button only (not a separate command) — tunnel enable requires provider-specific setup checks (binary installed? authtoken set?) that are better surfaced in the UI.

---

### D-06: 401-Burst Auto-Disable — Hardcoded Threshold + IP in SSE

**Decision:** 10 auth failures in a 60-second window triggers automatic tunnel disable.

- **Threshold:** Hardcoded constants in server.js — no VS Code setting.
- **On tripwire fire:**
  1. Call `options.onTunnelAutoDisable?.({ failures, windowMs, ip })` (injected callback from launcher)
  2. Publish SSE event `daemon:tunnel-auto-disabled` with payload `{ failures: number, windowMs: number, ip: string | null }`
  3. Launcher receives callback → writes `enabled: false` to `tunnel-settings.json` → clears `tunnelUrl` in lockfile
- **IP field:** The IP of the triggering request is included in the SSE payload so the Setup tab warning banner can show context ("Disabled: 10 failures from 203.0.113.x in 60s").

---

### D-07: Tunnel Admin Allowlist — Block /daemon/* from Tunnel Requests

**Decision:** Middleware detects tunnel-originated requests and returns 404 for all `/daemon/*` endpoints. Only `/mcp` is accessible from the tunnel.

**Detection:** Request is considered tunnel-originated if any of these headers are present:
- `X-Forwarded-For` (non-loopback value)
- `X-Forwarded-Proto: https`
- `cf-connecting-ip`

**Behavior:** Tunnel requests hitting `/daemon/*` → 404. Tunnel requests hitting `/mcp` → normal bearer-auth flow. Loopback requests → all paths normal.

Follows Perplexity's `tunnel-admin-allowlist.test.js` test pattern (port that test).

---

### Claude's Discretion

- **cf-named login wizard:** The Cloudflare Named Tunnel setup flow (cloudflared login → create tunnel → DNS) follows Perplexity's `cloudflared-named-setup.ts` pattern. Implementation details are for the planner.
- **`airtableFormula.tunnel.enable` command:** Not required as a separate command — Enable is Setup tab button only. Planner can add if it makes implementation cleaner.
- **ngrok optional domain in Setup tab:** Show a "Reserved domain (optional)" text field below the authtoken field when ngrok is selected. Saves to `tunnel-settings.json` `ngrokDomain` field. Planner implements.
- **`daemon install-tunnel` CLI subcommand:** Add to `packages/mcp-server/src/daemon/index.js` exports + CLI — installs cloudflared binary for cf-quick and cf-named. Follows Perplexity's pattern.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope
- `.planning/ROADMAP.md` §"Phase 7: Tunnel Support" — Goal, success criteria, requirements
- `.planning/REQUIREMENTS.md` §"Tunnel" — TUNNEL-01 through TUNNEL-04

### Prior Phase Context (daemon foundation)
- `.planning/phases/05-daemon-core/05-CONTEXT.md` — DaemonLockRecord schema (`tunnelUrl` field reserved here), config dir conventions, DaemonManager patterns
- `.planning/phases/06-lsp-server/06-CONTEXT.md` — port source reference, daemon lifecycle patterns

### Port Source — All tunnel files from Perplexity
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel.ts` — `startTunnel()`, `extractTunnelUrl()`, `TunnelState`, `StartedTunnel` interfaces
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\install-tunnel.ts` — `installCloudflared()`, `getTunnelBinaryPath()`, `resolvePinnedAssetKey()`
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\cloudflared-pins.json` — pinned cloudflared binary checksums (copy as-is)
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\types.ts` — `TunnelProvider`, `TunnelProviderId`, `SetupCheck`, `TunnelProviderStartOptions`
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\cloudflared-quick.ts` — cf-quick provider
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\ngrok.ts` — ngrok provider (lazy NAPI load, `NgrokNativeMissingError`, `loadNgrokNative()`)
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\ngrok-config.ts` — `readNgrokSettings()` (NOTE: Airtable version reads from tunnel-settings.json `ngrokDomain` + authtoken from request body, not a separate file)
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\cloudflared-named.ts` — cf-named provider
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\cloudflared-named-setup.ts` — cf-named setup wizard
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\index.ts` — provider registry barrel

### 401-Burst + Allowlist Test Pattern
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\test\daemon\tunnel-admin-allowlist.test.js` — tunnel allowlist test pattern to port
- `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\server.ts` lines 244–260 — `onTripwireTriggered` callback wiring pattern

### Airtable Daemon Files to Modify
- `packages/mcp-server/src/daemon/server.js` — add enable-tunnel/disable-tunnel endpoints + allowlist middleware + 401-burst tripwire
- `packages/mcp-server/src/daemon/launcher.js` — add tunnel lifecycle (startDaemon reads tunnel-settings.json, auto-starts, finalize stops)
- `packages/mcp-server/src/daemon/lockfile.js` — `tunnelUrl` field already in `normalizeRecord()` — no schema changes needed

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/mcp-server/src/daemon/launcher.js` — `startDaemon()`, `buildRecord()`, `syncLockfile()`, `finalize()` — tunnel start/stop hooks into these functions
- `packages/mcp-server/src/daemon/server.js` — `publishEvent()` for SSE broadcasts; `requireBearer` middleware pattern; `startDaemonServer()` options object for `onTunnelAutoDisable` callback injection
- `packages/mcp-server/src/daemon/lockfile.js` — `replace()` for atomic lockfile updates; `tunnelUrl: asOptionalString(...)` already in `normalizeRecord()`
- `packages/webview/src/tabs/Setup.tsx` — existing Setup tab; tunnel section will be added as a new `<div className="glass-panel">` block
- `packages/shared/src/types.ts` — `DashboardState` type; tunnel state fields to be added

### Established Patterns
- **SSE event publishing:** `publishEvent(event, payload)` in server.js — same pattern for `daemon:tunnel-auto-disabled`, `daemon:tunnel-started`, `daemon:tunnel-stopped`
- **Lockfile replace for state updates:** `syncLockfile()` in launcher.js calls `replace(buildRecord(), {lockPath, expectedUuid})` — same pattern for tunnelUrl updates
- **LSP subprocess lifecycle:** Phase 6 pattern — spawn tracked child, hold reference, SIGTERM in `finalize()` — tunnel child (cloudflared process) follows same pattern
- **Perplexity port pattern:** All daemon files are direct ports with `getConfigDir()` → `getHomeDir()` + Airtable env var renames

### Integration Points
- `launcher.js:startDaemon()` — after `syncLockfile()`, read tunnel-settings.json; if enabled, call `startTunnel()`; on state change, call `replace()` to update `tunnelUrl` in lockfile; in `finalize()`, call `tunnel.stop()`
- `server.js` — add `POST /daemon/enable-tunnel`, `POST /daemon/disable-tunnel` endpoints; add allowlist middleware before `requireBearer`; add `onTunnelAutoDisable` to options; include `tunnelUrl` in `/daemon/health` response
- `packages/extension/src/mcp/daemon-manager.ts` — `getDaemonStatus()` already reads `tunnelUrl` from lockfile; expose it to DashboardProvider
- `packages/webview/src/tabs/Setup.tsx` — add tunnel glass-panel section
- `packages/shared/src/types.ts` — add `TunnelState`, `TunnelProviderId` to `DashboardState`

</code_context>

<specifics>
## Specific Ideas

- **ngrok authtoken flow:** Setup tab shows masked input when ngrok selected + no token. Webview message type: `{ type: 'tunnel:set-ngrok-authtoken', authtoken: string }` → extension stores in SecretStorage key `airtable-formula.ngrok.authtoken`.
- **Enable-tunnel request body:** `POST /daemon/enable-tunnel` body: `{ provider: 'cf-quick' | 'ngrok' | 'cf-named', authtoken?: string, domain?: string }`. For cf-quick and cf-named, authtoken is omitted. For ngrok, extension reads from SecretStorage and injects.
- **Tunnel-settings.json location:** `path.join(configDir, 'tunnel-settings.json')` — `configDir` is `getHomeDir()` = `~/.airtable-user-mcp/`.
- **daemon:tunnel-auto-disabled SSE payload:** `{ failures: number, windowMs: number, ip: string | null }` — matches Perplexity's payload.
- **401-burst constants:** `BURST_FAILURE_COUNT = 10`, `BURST_WINDOW_MS = 60_000` — hardcoded in server.js, no VS Code setting.
- **Tunnel allowlist detection headers:** `X-Forwarded-For` (non-loopback), `X-Forwarded-Proto: https`, `cf-connecting-ip` — any one present means tunnel-originated request.

</specifics>

<deferred>
## Deferred Ideas

- **cf-named login wizard UX details** — Planner follows Perplexity's `cloudflared-named-setup.ts` pattern; no additional user specification needed.
- **Rate limiting beyond 401-burst** — per-IP rate limiting, per-UA blocklist (present in Perplexity's `createSecurity()`) — out of Phase 7 scope; deferred to Phase 8+ security hardening.
- **OAuth 2.1 for multi-user tunnel** — SEC-01 in REQUIREMENTS.md future scope. Bearer token is sufficient for Phase 7.
- **Setup tab comprehensive redesign** — Phase 8 scope (UI-01, UI-02, UI-03). Phase 7 adds a focused tunnel section to the existing Setup tab; full redesign is Phase 8.
- **Tunnel URL as auto-config transport** — Option for IDEs to use the tunnel URL as their MCP endpoint. UI-02 in Phase 8 scope.

</deferred>

---

*Phase: 7-tunnel-support*
*Context gathered: 2026-05-15*
