# Phase 7: Tunnel Support - Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 18 new/modified files
**Analogs found:** 16 / 18

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/mcp-server/src/safe-write.js` | utility | file-I/O | `VSCode-Perplexity-MCP/.../safe-write.js` | exact (copy verbatim) |
| `packages/mcp-server/src/daemon/cloudflared-pins.json` | config | file-I/O | `VSCode-Perplexity-MCP/.../cloudflared-pins.json` | exact (copy as-is) |
| `packages/mcp-server/src/daemon/tunnel.js` | utility | event-driven | `VSCode-Perplexity-MCP/.../tunnel.ts` | exact port |
| `packages/mcp-server/src/daemon/install-tunnel.js` | utility | file-I/O | `VSCode-Perplexity-MCP/.../install-tunnel.ts` | exact port |
| `packages/mcp-server/src/daemon/tunnel-providers/types.js` | utility | — | `VSCode-Perplexity-MCP/.../tunnel-providers/types.ts` | exact port |
| `packages/mcp-server/src/daemon/tunnel-providers/cloudflared-quick.js` | service | event-driven | `VSCode-Perplexity-MCP/.../cloudflared-quick.ts` | exact port |
| `packages/mcp-server/src/daemon/tunnel-providers/ngrok.js` | service | event-driven | `VSCode-Perplexity-MCP/.../ngrok.ts` | port with adaptation |
| `packages/mcp-server/src/daemon/tunnel-providers/cloudflared-named.js` | service | event-driven | `VSCode-Perplexity-MCP/.../cloudflared-named.ts` | exact port |
| `packages/mcp-server/src/daemon/tunnel-providers/cloudflared-named-setup.js` | utility | file-I/O | `VSCode-Perplexity-MCP/.../cloudflared-named-setup.ts` | exact port |
| `packages/mcp-server/src/daemon/tunnel-providers/index.js` | service | CRUD | `VSCode-Perplexity-MCP/.../tunnel-providers/index.ts` | port with adaptation |
| `packages/mcp-server/src/daemon/server.js` | middleware/controller | request-response | `packages/mcp-server/src/daemon/server.js` (self, MODIFY) | self-analog |
| `packages/mcp-server/src/daemon/launcher.js` | service | event-driven | `packages/mcp-server/src/daemon/launcher.js` (self, MODIFY) | self-analog |
| `packages/mcp-server/src/daemon/index.js` | config | — | `packages/mcp-server/src/daemon/index.js` (self, MODIFY) | self-analog |
| `packages/shared/src/types.ts` | model | — | `packages/shared/src/types.ts` (self, MODIFY) | self-analog |
| `packages/shared/src/messages.ts` | model | request-response | `packages/shared/src/messages.ts` (self, MODIFY) | self-analog |
| `packages/extension/src/webview/DashboardProvider.ts` | controller | request-response | `packages/extension/src/webview/DashboardProvider.ts` (self, MODIFY) | self-analog |
| `packages/webview/src/tabs/Setup.tsx` | component | request-response | `packages/webview/src/tabs/Setup.tsx` (self, MODIFY) | self-analog |
| `packages/mcp-server/test/test-tunnel-*.test.js` (3 files) | test | request-response | `packages/mcp-server/test/test-daemon-server.test.js` | role-match |

---

## Pattern Assignments

### `packages/mcp-server/src/safe-write.js` (utility, file-I/O)

**Analog:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\safe-write.js`
**Action:** Copy verbatim. 28 lines. No adaptation needed.

**Complete file** (lines 1-27):
```javascript
import { writeFileSync, renameSync, rmSync } from "node:fs";

export function safeAtomicWriteFileSync(path, data, opts) {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, data, opts);
    renameSync(tmp, path);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}
```

**Adaptation:** None. Rename `node:fs` imports are already the Airtable-compatible ESM form.

---

### `packages/mcp-server/src/daemon/tunnel.js` (utility, event-driven)

**Analog:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel.ts`

**Imports pattern** (lines 1-8):
```javascript
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const execFile = promisify(execFileCallback);
```

**Core pattern — neutral config + subprocess spawn** (lines 59-77):
```javascript
export function startTunnel(options) {
  // options: { command, args?, port, env?, onStateChange? }
  const neutralConfigPath = ensureNeutralConfig(options.command);
  const spawnArgs = [
    ...(options.args ?? []),
    "tunnel",
    "--no-autoupdate",
    ...(neutralConfigPath ? ["--config", neutralConfigPath] : []),
    "--url", `http://127.0.0.1:${options.port}`,
  ];
  const child = spawn(options.command, spawnArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    windowsHide: true,
    env: options.env,
  });
  // ...
}
```

**URL extraction from both stdout and stderr** (lines 106-123):
```javascript
const handleLine = (line) => {
  const url = extractTunnelUrl(line);
  if (!url || settled) return;
  settled = true;
  updateState({ status: "enabled", url, pid: child.pid ?? null, error: null });
  resolveReady(url);
};
createInterface({ input: child.stderr }).on("line", handleLine);
createInterface({ input: child.stdout }).on("line", handleLine);
```

**Windows-safe process kill** (lines 151-177):
```javascript
const stop = async () => {
  if (stopping) return;
  stopping = true;
  if (child.exitCode !== null || child.killed) {
    updateState({ status: "disabled", url: null, pid: null, error: null });
    return;
  }
  if (process.platform === "win32") {
    await execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    }).catch(() => undefined);
    await exited;
    return;
  }
  child.kill("SIGTERM");
  await exited;
};
```

**URL regex** (lines 187-190):
```javascript
export function extractTunnelUrl(line) {
  const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu);
  return match?.[0] ?? null;
}
```

**Adaptation:** Remove all TypeScript type annotations. Replace `"perplexity-user-mcp"` string literals in comments with `"airtable-user-mcp"`. The `ensureNeutralConfig()` comment references `NEUTRAL_CONFIG_BODY` — replace the comment string to say `airtable-user-mcp Quick Tunnel`.

---

### `packages/mcp-server/src/daemon/install-tunnel.js` (utility, file-I/O)

**Analog:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\install-tunnel.ts`

**Imports pattern** (lines 1-6):
```javascript
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pins from "./cloudflared-pins.json" assert { type: "json" };
```

**Core pattern — download + checksum + extract** (lines 25-59):
```javascript
export async function installCloudflared(options = {}) {
  const configDir = options.configDir ?? getHomeDir();  // Airtable: getHomeDir() not getConfigDir()
  const assetKey = resolvePinnedAssetKey(options.platform ?? process.platform, options.arch ?? process.arch);
  const asset = pins.assets[assetKey];
  const downloadUrl = `https://github.com/cloudflare/cloudflared/releases/download/${pins.version}/${asset.filename}`;
  const response = await (options.fetchImpl ?? fetch)(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download cloudflared (${response.status} ${response.statusText}).`);
  }
  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(archiveBuffer).digest("hex");
  if (sha256 !== asset.sha256) {
    throw new Error(`cloudflared checksum mismatch for ${asset.filename}.`);
  }
  // ...
}
```

**Adaptation:** Replace `getConfigDir()` import from Perplexity's `profiles.js` with `getHomeDir()` from `../paths.js`. Remove TypeScript type annotations.

---

### `packages/mcp-server/src/daemon/tunnel-providers/types.js` (utility)

**Analog:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\types.ts`

**Core pattern — JSDoc translation** (lines 1-53):
```javascript
// Port from types.ts — strip all TypeScript, replace with JSDoc
// TunnelProviderId: 'cf-quick' | 'ngrok' | 'cf-named'

/**
 * @typedef {'cf-quick' | 'ngrok' | 'cf-named'} TunnelProviderId
 */

/**
 * @typedef {Object} TunnelProviderStartOptions
 * @property {number} port
 * @property {string} configDir
 * @property {(state: import('../tunnel.js').TunnelState) => void} onStateChange
 * @property {string} [authtoken]  — Airtable addition: ngrok authtoken from SecretStorage
 * @property {string} [domain]    — Airtable addition: ngrok reserved domain
 */

/**
 * @typedef {Object} TunnelProvider
 * @property {TunnelProviderId} id
 * @property {string} displayName
 * @property {string} description
 * @property {(configDir: string) => Promise<SetupCheck>} isSetupComplete
 * @property {(options: TunnelProviderStartOptions) => Promise<import('../tunnel.js').StartedTunnel>} start
 */
```

**Adaptation:** This file becomes pure JSDoc declarations (no exports, since JS doesn't need interface re-exports). Add `authtoken?: string` and `domain?: string` to `TunnelProviderStartOptions` — these are Airtable additions absent from Perplexity's `types.ts`.

---

### `packages/mcp-server/src/daemon/tunnel-providers/cloudflared-quick.js` (service, event-driven)

**Analog:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\cloudflared-quick.ts`

**Complete pattern** (lines 1-43):
```javascript
import { existsSync } from "node:fs";
import { startTunnel } from "../tunnel.js";
import { getTunnelBinaryPath } from "../install-tunnel.js";

export const cloudflaredQuickProvider = {
  id: "cf-quick",
  displayName: "Cloudflare Quick Tunnel",
  description: "Zero-setup ephemeral *.trycloudflare.com URL. Changes on every restart.",

  async isSetupComplete(configDir) {
    const binaryPath = getTunnelBinaryPath(configDir);
    if (!existsSync(binaryPath)) {
      return {
        ready: false,
        reason: "cloudflared binary not installed.",
        action: { label: "Install cloudflared", kind: "install-binary" },
      };
    }
    return { ready: true };
  },

  async start(options) {
    const binaryPath = getTunnelBinaryPath(options.configDir);
    if (!existsSync(binaryPath)) {
      throw new Error(
        "cloudflared is not installed. Run `npx airtable-user-mcp daemon install-tunnel` first.",
      );
    }
    return startTunnel({
      command: binaryPath,
      port: options.port,
      onStateChange: options.onStateChange,
    });
  },
};
```

**Adaptation:** Replace `"perplexity-user-mcp"` with `"airtable-user-mcp"` in the error message. Remove TypeScript imports.

---

### `packages/mcp-server/src/daemon/tunnel-providers/ngrok.js` (service, event-driven)

**Analog:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\ngrok.ts`

**Imports pattern** (lines 1-4 — adapted):
```javascript
// No import of ngrok-config — authtoken comes from options.authtoken (SecretStorage)
// DO NOT import readNgrokSettings — Airtable key adaptation (D-02)
```

**NgrokNativeMissingError class** (lines 35-55):
```javascript
export class NgrokNativeMissingError extends Error {
  constructor(cause) {
    const platform = process.platform;
    const arch = process.arch;
    const message =
      `@ngrok/ngrok native binding for ${platform}-${arch} is not available in this VSIX. ` +
      `Reinstall the extension (or install @ngrok/ngrok manually) to use the ngrok provider, ` +
      `or switch to the cloudflared provider in the dashboard.`;
    super(message);
    this.name = "NgrokNativeMissingError";
    this.platform = platform;
    this.arch = arch;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
```

**Lazy load pattern** (lines 94-115):
```javascript
let cachedNgrok = null;

function isNativeMissingError(err) {
  if (!err) return false;
  const code = err.code;
  if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /Cannot find module ['"]@ngrok\/ngrok[-/]/i.test(message);
}

export async function loadNgrokNative() {
  if (cachedNgrok) return cachedNgrok;
  try {
    const mod = await import("@ngrok/ngrok");
    const resolved = (mod.default ?? mod);
    if (typeof resolved?.forward !== "function") {
      throw new Error("@ngrok/ngrok module did not expose forward(); API changed?");
    }
    cachedNgrok = resolved;
    return resolved;
  } catch (err) {
    if (isNativeMissingError(err)) {
      throw new NgrokNativeMissingError(err);
    }
    throw err;
  }
}
```

**isSetupComplete adaptation** (Airtable-specific — no disk authtoken check):
```javascript
async isSetupComplete(configDir) {
  // Step 1: native binding check (same as Perplexity)
  const probe = await isNgrokNativeAvailable();
  if (!probe.available) {
    return { ready: false, reason: probe.error.message };
  }
  // Step 2: Airtable-specific — do NOT check disk for authtoken.
  // Authtoken comes from VS Code SecretStorage via enable-tunnel request body.
  // isSetupComplete only checks native availability.
  return { ready: true };
},
```

**start() adaptation** (Airtable-specific — authtoken from options not disk):
```javascript
async start(options) {
  // options.authtoken injected by extension from SecretStorage
  const authtoken = options.authtoken;
  if (!authtoken) {
    throw new Error('ngrok authtoken required. Provide it via the Setup tab — it is read from VS Code SecretStorage.');
  }
  const ngrok = await loadNgrokNative();
  // ngrok.kill() before forward() to avoid ERR_NGROK_334
  try {
    if (typeof ngrok.kill === "function") await ngrok.kill();
  } catch { /* best-effort */ }

  const listener = await ngrok.forward({
    addr: options.port,
    authtoken,
    ...(options.domain ? { domain: options.domain } : {}),
    forwards_to: `airtable-mcp (port ${options.port})`,
  });
  // ... (remainder mirrors Perplexity ngrok.ts start() exactly)
}
```

**Key adaptation:** Remove all references to `readNgrokSettings` / `ngrok-config.js`. `authtoken` and `domain` come from `options` (injected by the extension from SecretStorage and `tunnel-settings.json` respectively). `translateNgrokError()` is copied verbatim with `"perplexity-user-mcp"` → `"airtable-user-mcp"` substitution.

---

### `packages/mcp-server/src/daemon/tunnel-providers/cloudflared-named.js` (service, event-driven)

**Analog:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\cloudflared-named.ts`

**Adaptation:** Remove TypeScript annotations. Replace `getConfigDir()` with `getHomeDir()`. Replace `"perplexity-user-mcp"` with `"airtable-user-mcp"` in error messages. The `READY_LINE_REGEX = /Registered tunnel connection/i` pattern and `writeTunnelConfig()` on every start are ported verbatim (critical for port-drift fix).

---

### `packages/mcp-server/src/daemon/tunnel-providers/cloudflared-named-setup.js` (utility, file-I/O)

**Analog:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\cloudflared-named-setup.ts`

**Adaptation:** Remove TypeScript annotations. Replace `getConfigDir()` with `getHomeDir()`. Replace `safeAtomicWriteFileSync` import path: Perplexity uses `"../../safe-write.js"` — Airtable uses same relative path `"../../safe-write.js"` from `tunnel-providers/` subdirectory. Replace all `"perplexity-user-mcp"` command references with `"airtable-user-mcp"`.

---

### `packages/mcp-server/src/daemon/tunnel-providers/index.js` (service, CRUD)

**Analog:** `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\tunnel-providers\index.ts`

**Imports pattern** (adapted):
```javascript
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { safeAtomicWriteFileSync } from "../../safe-write.js";

import { cloudflaredQuickProvider } from "./cloudflared-quick.js";
import { cloudflaredNamedProvider } from "./cloudflared-named.js";
import { ngrokProvider, NgrokNativeMissingError } from "./ngrok.js";
```

**Provider registry pattern** (lines 40-52):
```javascript
const REGISTRY = {
  "cf-quick": cloudflaredQuickProvider,
  "ngrok": ngrokProvider,
  "cf-named": cloudflaredNamedProvider,
};

export function getTunnelProvider(id) {
  const provider = REGISTRY[id];
  if (!provider) {
    throw new Error(`Unknown tunnel provider: ${id}`);
  }
  return provider;
}

export function listTunnelProviders() {
  return Object.values(REGISTRY);
}
```

**readTunnelSettings/writeTunnelSettings — Airtable schema** (D-03, verified in RESEARCH.md):
```javascript
const VALID_PROVIDERS = ['cf-quick', 'ngrok', 'cf-named'];

export function getTunnelSettingsPath(configDir) {
  return join(configDir, 'tunnel-settings.json');
}

export function readTunnelSettings(configDir) {
  const path = getTunnelSettingsPath(configDir);
  const defaults = { enabled: false, provider: 'cf-quick', ngrokDomain: null };
  if (!existsSync(path)) return defaults;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      enabled: parsed.enabled === true,
      provider: VALID_PROVIDERS.includes(parsed.provider) ? parsed.provider : 'cf-quick',
      ngrokDomain: typeof parsed.ngrokDomain === 'string' ? parsed.ngrokDomain : null,
    };
  } catch { return defaults; }
}

export function writeTunnelSettings(configDir, patch) {
  const path = getTunnelSettingsPath(configDir);
  const prev = readTunnelSettings(configDir);
  const next = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : prev.enabled,
    provider: VALID_PROVIDERS.includes(patch.provider) ? patch.provider : prev.provider,
    ngrokDomain: 'ngrokDomain' in patch ? (patch.ngrokDomain ?? null) : prev.ngrokDomain,
  };
  mkdirSync(dirname(path), { recursive: true });
  safeAtomicWriteFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}
```

**Key adaptation from Perplexity:** Perplexity schema is `{ activeProvider, updatedAt }`. Airtable schema is `{ enabled, provider, ngrokDomain }`. Field name `activeProvider` → `provider`. `writeTunnelSettings` does NOT export `readNgrokSettings` / `writeNgrokSettings` — those are not ported. The barrel does NOT re-export `ngrok-config.js` exports.

---

### `packages/mcp-server/src/daemon/server.js` (middleware/controller, request-response)

**Analog:** `packages/mcp-server/src/daemon/server.js` (self-modification)

**Allowlist middleware pattern** (insert BEFORE `app.use(expressFactory.json(...))`):
```javascript
// Must run before express.json() and before requireBearer
function isTunnelRequest(req) {
  if (req.headers?.['x-forwarded-for']) return true;
  if (req.headers?.['cf-connecting-ip']) return true;
  const ip = req.socket?.remoteAddress ?? '';
  if (ip && ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') return true;
  return false;
}

app.use((req, res, next) => {
  if (!isTunnelRequest(req)) return next();
  const p = req.path;
  if (p.startsWith('/mcp') || p === '/') return next();
  res.status(404).json({ error: 'Not found' });
});
```

**401-burst tripwire** (inline constants + tracker, insert after `let closed = false`):
```javascript
const BURST_FAILURE_COUNT = 10;
const BURST_WINDOW_MS = 60_000;
let authFailureCount = 0;
let burstWindowStart = Date.now();
let tunnelAutoDisabled = false;

const track401Burst = (req) => {
  const now = Date.now();
  if (now - burstWindowStart > BURST_WINDOW_MS) {
    authFailureCount = 0;
    burstWindowStart = now;
  }
  authFailureCount++;
  if (authFailureCount >= BURST_FAILURE_COUNT && !tunnelAutoDisabled && isTunnelRequest(req)) {
    tunnelAutoDisabled = true;
    const ip = req.headers?.['cf-connecting-ip']
      ?? req.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
      ?? null;
    publishEvent('daemon:tunnel-auto-disabled', { failures: authFailureCount, windowMs: BURST_WINDOW_MS, ip });
    options.onTunnelAutoDisable?.({ failures: authFailureCount, windowMs: BURST_WINDOW_MS, ip });
  }
};
```

**requireBearer modification** (call `track401Burst` on 401):
```javascript
const requireBearer = (req, res, next) => {
  const header = req.headers?.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const provided = match ? match[1] : null;
  if (provided !== currentToken.bearerToken) {
    track401Burst(req);  // ADD THIS LINE
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};
```

**enable-tunnel endpoint pattern** (modeled from existing `POST /daemon/rotate-token` at lines 169-181):
```javascript
// POST /daemon/enable-tunnel
// body: { provider: 'cf-quick'|'ngrok'|'cf-named', authtoken?: string, domain?: string }
app.post('/daemon/enable-tunnel', requireBearer, async (req, res, next) => {
  try {
    const { provider, authtoken, domain } = req.body ?? {};
    if (activeTunnel) {
      await activeTunnel.stop().catch(() => undefined);
      activeTunnel = null;
    }
    writeTunnelSettings(options.configDir, { enabled: true, provider, ngrokDomain: domain ?? null });
    const p = getTunnelProvider(provider);
    activeTunnel = await p.start({
      port: getBoundPort(httpServer),
      configDir: options.configDir,
      authtoken,
      domain,
      onStateChange: (state) => {
        if (state.url) {
          options.onTunnelUrlChange?.(state.url);
        } else if (state.status === 'crashed' || state.status === 'disabled') {
          options.onTunnelUrlChange?.(null);
        }
      },
    });
    const url = await activeTunnel.waitUntilReady;
    publishEvent('daemon:tunnel-started', { url });
    tunnelAutoDisabled = false;
    res.json({ ok: true, url });
  } catch (err) { next(err); }
});

// POST /daemon/disable-tunnel
app.post('/daemon/disable-tunnel', requireBearer, async (_req, res, next) => {
  try {
    if (activeTunnel) {
      await activeTunnel.stop().catch(() => undefined);
      activeTunnel = null;
    }
    writeTunnelSettings(options.configDir, { enabled: false });
    options.onTunnelUrlChange?.(null);
    publishEvent('daemon:tunnel-stopped', {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```

**getHealth modification** (include tunnelUrl):
```javascript
// In getHealth(), add tunnelUrl field:
const getHealth = () => ({
  ok: true,
  pid: process.pid,
  uuid: options.uuid ?? null,
  version,
  port: getBoundPort(httpServer),
  uptimeMs: Date.now() - startedAt,
  startedAt: new Date(startedAt).toISOString(),
  tunnelUrl: activeTunnel?.getState?.()?.url ?? null,  // ADD THIS
});
```

**stop() modification** (stop tunnel before HTTP server close):
```javascript
// In stop(), add before runShutdownStep('sse-clients', ...):
await runShutdownStep('tunnel-stop', () => activeTunnel?.stop().catch(() => undefined));
```

**Module-level state to add** (after `let closed = false`):
```javascript
let activeTunnel = null;
```

---

### `packages/mcp-server/src/daemon/launcher.js` (service, event-driven)

**Analog:** `packages/mcp-server/src/daemon/launcher.js` (self-modification)

**Additional imports** (add to existing import block at lines 1-11):
```javascript
import { readTunnelSettings, writeTunnelSettings, getTunnelProvider } from './tunnel-providers/index.js';
```

**Auto-start tunnel after syncLockfile** (insert after `syncLockfile(server.bearerToken)` at line 339, before LSP spawn):
```javascript
let activeTunnel = null;

const startTunnelIfConfigured = async () => {
  const settings = readTunnelSettings(configDir);
  if (!settings.enabled) return;
  // ngrok cannot auto-start: authtoken lives in VS Code SecretStorage, not accessible to daemon process
  if (settings.provider === 'ngrok') return;
  try {
    const provider = getTunnelProvider(settings.provider);
    const check = await provider.isSetupComplete(configDir);
    if (!check.ready) return; // binary not installed — skip silently
    activeTunnel = await provider.start({
      port: server.port,
      configDir,
      onStateChange: (state) => {
        if (state.url) {
          replace({ ...buildRecord(), tunnelUrl: state.url }, { lockPath, expectedUuid: uuid });
        } else if (state.status === 'crashed' || state.status === 'disabled') {
          replace({ ...buildRecord(), tunnelUrl: null }, { lockPath, expectedUuid: uuid });
          writeTunnelSettings(configDir, { enabled: false });
        }
      },
    });
  } catch (err) {
    // Non-fatal: daemon continues without tunnel
    console.error(`[airtable-mcp] Tunnel auto-start failed: ${err instanceof Error ? err.message : String(err)}`);
    writeTunnelSettings(configDir, { enabled: false });
  }
};

await startTunnelIfConfigured();
```

**buildRecord modification** (add tunnelUrl tracking, replace static `tunnelUrl: null` at line 291):
```javascript
const buildRecord = (bearerToken = server?.bearerToken ?? token.bearerToken) => {
  let currentPortLsp = null;
  try {
    const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
    currentPortLsp = existing.port_lsp ?? null;
  } catch { /* lockfile may not exist yet */ }
  return {
    pid: process.pid,
    uuid,
    port: server?.port ?? provisional.port,
    port_lsp: currentPortLsp,
    bearerToken,
    version,
    startedAt,
    tunnelUrl: activeTunnel?.getState?.()?.url ?? null,  // CHANGE: was hardcoded null
  };
};
```

**finalize() modification** (add tunnel stop before LSP kill at line 306):
```javascript
const finalize = async () => {
  if (!finalizePromise) {
    finalizePromise = (async () => {
      if (options.signal && abortHandler) {
        options.signal.removeEventListener('abort', abortHandler);
      }
      process.off('SIGINT', signalHandler);
      process.off('SIGTERM', signalHandler);
      activeTunnel?.stop().catch(() => undefined);  // ADD: stop tunnel before LSP kill
      lspChild?.kill('SIGTERM');
      release({ lockPath, expectedUuid: uuid });
      finalizeResolve?.();
    })();
  }
  await finalizePromise;
};
```

**onTunnelAutoDisable callback wiring** (add to `startDaemonServer` options at lines 326-337):
```javascript
server = await startDaemonServer({
  // ... existing options ...
  onTunnelAutoDisable: async ({ failures, windowMs, ip }) => {
    if (activeTunnel) {
      await activeTunnel.stop().catch(() => undefined);
      activeTunnel = null;
    }
    writeTunnelSettings(configDir, { enabled: false });
    replace({ ...buildRecord(), tunnelUrl: null }, { lockPath, expectedUuid: uuid });
  },
  onTunnelUrlChange: (url) => {
    replace({ ...buildRecord(), tunnelUrl: url }, { lockPath, expectedUuid: uuid });
  },
});
```

---

### `packages/mcp-server/src/daemon/index.js` (config)

**Analog:** `packages/mcp-server/src/daemon/index.js` (self-modification)

**Current file** (lines 1-4):
```javascript
export * from './lockfile.js';
export * from './token.js';
export * from './server.js';
export * from './launcher.js';
```

**Addition:**
```javascript
export * from './lockfile.js';
export * from './token.js';
export * from './server.js';
export * from './launcher.js';
export * from './tunnel-providers/index.js';  // ADD: expose tunnel provider registry + settings
export * from './install-tunnel.js';           // ADD: expose installCloudflared for CLI subcommand
```

---

### `packages/shared/src/types.ts` (model)

**Analog:** `packages/shared/src/types.ts` (self-modification)

**Pattern — how new types are added** (observe `BrowserDownloadState` pattern at lines 37-43):
```typescript
// Existing pattern for status union + state object:
export type BrowserDownloadStatus = 'idle' | 'downloading' | 'done' | 'error';
export interface BrowserDownloadState {
  status:    BrowserDownloadStatus;
  progress?: number;
  error?:    string;
}
```

**New types to add** (follow same pattern, add before `DashboardState`):
```typescript
export type TunnelProviderId = 'cf-quick' | 'ngrok' | 'cf-named';

export type TunnelStatus = 'disabled' | 'starting' | 'active' | 'auto-disabled' | 'error';

export interface TunnelAutoDisabledReason {
  failures: number;
  windowMs: number;
  ip: string | null;
}

export interface TunnelState {
  status:             TunnelStatus;
  url:                string | null;
  provider:           TunnelProviderId;
  ngrokAuthtokenSet:  boolean;
  autoDisabledReason: TunnelAutoDisabledReason | null;
}
```

**DashboardState modification** (add optional tunnel field, following `debug?` and `storage?` pattern at lines 154-156):
```typescript
export interface DashboardState {
  ideStatuses:  IdeStatus[];
  versions:     VersionInfo;
  aiFilesCount: number;
  loading:      boolean;
  settings:     SettingsSnapshot;
  auth:         AuthState;
  debug?:       DebugState;
  storage?:     StorageInfo;
  tunnel?:      TunnelState;   // ADD: undefined when daemon is not running
}
```

---

### `packages/shared/src/messages.ts` (model, request-response)

**Analog:** `packages/shared/src/messages.ts` (self-modification)

**Existing WebviewMessage pattern** (lines 11-33):
```typescript
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'action:setupIde';  id: string; ideId: IdeId }
  | { type: 'action:refresh';   id: string }
  // ...
```

**New WebviewMessage variants to add** (follow existing union member style):
```typescript
  | { type: 'tunnel:enable';              id: string; provider: TunnelProviderId; authtoken?: string; domain?: string }
  | { type: 'tunnel:disable';             id: string }
  | { type: 'tunnel:set-ngrok-authtoken'; id: string; authtoken: string }
```

**Import addition** (add `TunnelProviderId` to existing import from types):
```typescript
import type { IdeId, DashboardState, IdeStatus, SettingsSnapshot, AuthState, TunnelProviderId } from './types.js';
```

---

### `packages/extension/src/webview/DashboardProvider.ts` (controller, request-response)

**Analog:** `packages/extension/src/webview/DashboardProvider.ts` (self-modification)

**setXxx method pattern** (lines 36-38 — how new manager refs are wired):
```typescript
setAuthManager(authManager: AuthManager): void {
  this.authManager = authManager;
  authManager.onDidChange(state => { ... });
}
setToolProfileManager(mgr: ToolProfileManager): void {
  this.toolProfileManager = mgr;
}
```

**New setDaemonManager method** (add following same pattern):
```typescript
private _daemonManager?: DaemonManager;

setDaemonManager(mgr: DaemonManager): void {
  this._daemonManager = mgr;
}
```

**handleMessage pattern** (lines 51-393 — one `if` block per message type, try/catch + postResult):
```typescript
if (msg.type === 'action:login') {
  try {
    await this.authManager?.login();
    await this.pushState();
    this.postResult(msg.id, true);
  } catch (err) {
    this.postResult(msg.id, false, String(err));
  }
  return;
}
```

**New tunnel message handlers** (add after existing handlers, before closing brace):
```typescript
if (msg.type === 'tunnel:set-ngrok-authtoken') {
  try {
    await this.context.secrets.store('airtable-formula.ngrok.authtoken', msg.authtoken);
    this.postResult(msg.id, true);
  } catch (err) { this.postResult(msg.id, false, String(err)); }
  return;
}

if (msg.type === 'tunnel:enable') {
  try {
    const status = await this._daemonManager?.getDaemonStatus();
    if (!status?.running || !status.port || !status.bearerToken) {
      this.postResult(msg.id, false, 'Daemon not running');
      return;
    }
    let authtoken: string | undefined = msg.authtoken;
    if (msg.provider === 'ngrok' && !authtoken) {
      authtoken = await this.context.secrets.get('airtable-formula.ngrok.authtoken') ?? undefined;
    }
    await fetch(`http://127.0.0.1:${status.port}/daemon/enable-tunnel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${status.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: msg.provider, authtoken, domain: msg.domain }),
    });
    await this.pushState();
    this.postResult(msg.id, true);
  } catch (err) { this.postResult(msg.id, false, String(err)); }
  return;
}

if (msg.type === 'tunnel:disable') {
  try {
    const status = await this._daemonManager?.getDaemonStatus();
    if (status?.running && status.port && status.bearerToken) {
      await fetch(`http://127.0.0.1:${status.port}/daemon/disable-tunnel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${status.bearerToken}` },
      });
    }
    await this.pushState();
    this.postResult(msg.id, true);
  } catch (err) { this.postResult(msg.id, false, String(err)); }
  return;
}
```

**pushState modification** (add tunnel field to state object, following `debug` and `storage` pattern at lines 441-478):
```typescript
const state: DashboardState = {
  // ... existing fields ...
  debug: debugState,
  storage,
  tunnel: await this._computeTunnelState(),  // ADD
};
```

**_computeTunnelState method** (new private method, pattern from `_computeStorageInfo`):
```typescript
private async _computeTunnelState(): Promise<import('@airtable-formula/shared').TunnelState | undefined> {
  try {
    const pathMod = await import('path');
    const osMod = await import('os');
    const fsMod = await import('fs');
    const configDir = pathMod.join(osMod.homedir(), '.airtable-user-mcp');
    const settingsPath = pathMod.join(configDir, 'tunnel-settings.json');
    const ngrokAuthtokenSet = !!(await this.context.secrets.get('airtable-formula.ngrok.authtoken'));
    // Read tunnel-settings.json for provider + enabled state
    // Read lockfile for tunnelUrl
    // Construct TunnelState from both sources
    // ...
  } catch { return undefined; }
}
```

---

### `packages/webview/src/tabs/Setup.tsx` (component, request-response)

**Analog:** `packages/webview/src/tabs/Setup.tsx` (self-modification)

**glass-panel section pattern** (lines 17-37 — how a new section is added):
```tsx
<div className="glass-panel">
  <div className="section-header">
    <div className="eyebrow">IDE Configuration</div>
    <div className="title">Setup</div>
    <div className="detail">...</div>
  </div>
  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
    <button className="btn btn-primary" onClick={fn} disabled={isLoading}>
      {isLoading ? 'Loading...' : 'Label'}
    </button>
  </div>
</div>
```

**New tunnel glass-panel section** (add as first panel in the `stack stack-lg` div, before IDE Configuration):
```tsx
{/* Tunnel section */}
<div className="glass-panel">
  <div className="section-header">
    <div className="eyebrow">Remote Access</div>
    <div className="title">Tunnel</div>
    <div className="detail">
      Expose your local MCP server to remote AI clients via a public HTTPS URL.
    </div>
  </div>

  {/* 401-burst warning banner — shown when tunnel auto-disabled */}
  {tunnel?.status === 'auto-disabled' && tunnel.autoDisabledReason && (
    <div style={{ background: 'var(--fg-warn)', borderRadius: 6, padding: '8px 12px', marginBottom: 8, fontSize: '0.72rem' }}>
      Tunnel auto-disabled: {tunnel.autoDisabledReason.failures} auth failures in{' '}
      {tunnel.autoDisabledReason.windowMs / 1000}s
      {tunnel.autoDisabledReason.ip ? ` from ${tunnel.autoDisabledReason.ip}` : ''}.
    </div>
  )}

  {/* Provider picker */}
  <div style={{ marginBottom: 8 }}>
    <select value={selectedProvider} onChange={e => setSelectedProvider(e.target.value)}>
      <option value="cf-quick">Cloudflare Quick Tunnel (ephemeral, zero-config)</option>
      <option value="ngrok">ngrok (persistent URL, requires authtoken)</option>
      <option value="cf-named">Cloudflare Named Tunnel (persistent, requires setup)</option>
    </select>
  </div>

  {/* ngrok authtoken input (shown when ngrok selected + no token) */}
  {selectedProvider === 'ngrok' && !tunnel?.ngrokAuthtokenSet && (
    <div style={{ marginBottom: 8 }}>
      <input type="password" placeholder="Paste ngrok authtoken" onChange={e => setNgrokAuthtoken(e.target.value)} />
      {/* ngrok optional domain */}
      <input type="text" placeholder="Reserved domain (optional, e.g. yourname.ngrok-free.app)" onChange={e => setNgrokDomain(e.target.value)} />
    </div>
  )}

  {/* Tunnel URL display */}
  {tunnel?.url && (
    <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', marginBottom: 8 }}>
      {tunnel.url}
    </div>
  )}

  {/* Enable/Disable button */}
  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
    {tunnel?.status === 'active' || tunnel?.status === 'starting' ? (
      <button className="btn btn-secondary" onClick={handleDisableTunnel} disabled={isTunnelPending}>
        {isTunnelPending ? 'Stopping...' : 'Disable Tunnel'}
      </button>
    ) : (
      <button className="btn btn-primary" onClick={handleEnableTunnel} disabled={isTunnelPending}>
        {isTunnelPending ? 'Starting...' : 'Enable Tunnel'}
      </button>
    )}
  </div>
</div>
```

**useStore integration pattern** (observe how `pendingActions`, `setupIde` etc. are pulled from store at lines 6-12):
```tsx
const { ideStatuses, pendingActions, setupIde, setupAll, unconfigureIde } = useStore();
// Tunnel additions follow same pattern:
const { tunnel, enableTunnel, disableTunnel, setNgrokAuthtoken } = useStore();
```

---

### `packages/mcp-server/test/test-tunnel-allowlist.test.js` (test)
### `packages/mcp-server/test/test-tunnel-lifecycle.test.js` (test)
### `packages/mcp-server/test/test-tunnel-settings.test.js` (test)

**Analog:** `packages/mcp-server/test/test-daemon-server.test.js`

**Test file structure pattern** (lines 1-23):
```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { startDaemonServer } from '../src/daemon/server.js';

let tmpDir;
let server;

before(async () => {
  tmpDir = join(tmpdir(), 'test-airtable-<name>-' + process.pid);
  mkdirSync(tmpDir, { recursive: true });
  server = await startDaemonServer({ port: 0, configDir: tmpDir });
});

after(async () => {
  if (server) {
    await server.stop().catch(() => {});
    server = null;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});
```

**Assertion pattern** (lines 39-56):
```javascript
describe('GET /daemon/health', () => {
  it('returns 200 with correct bearer', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/daemon/health`, {
      headers: { 'Authorization': `Bearer ${server.bearerToken}` },
    });
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.ok, true);
  });
});
```

**Allowlist test adaptation** (from Perplexity's `tunnel-admin-allowlist.test.js` lines 36-76):
```javascript
// Airtable adaptation: use node:test not vitest; strip OAuth paths; keep /daemon/* matrix
const tunnelHeaders = {
  'X-Forwarded-For': '203.0.113.5, 127.0.0.1',
  'X-Forwarded-Proto': 'https',
};

const DAEMON_PATHS = [
  { method: 'GET',  path: '/daemon/health' },
  { method: 'GET',  path: '/daemon/events' },
  { method: 'POST', path: '/daemon/heartbeat' },
  { method: 'POST', path: '/daemon/rotate-token' },
  { method: 'POST', path: '/daemon/shutdown' },
  { method: 'POST', path: '/daemon/enable-tunnel' },
  { method: 'POST', path: '/daemon/disable-tunnel' },
];

for (const { method, path } of DAEMON_PATHS) {
  it(`tunnel ${method} ${path} returns 404`, async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
      method,
      headers: { ...tunnelHeaders, Authorization: `Bearer ${server.bearerToken}` },
    });
    assert.strictEqual(res.status, 404);
  });
}
```

---

## Shared Patterns

### SSE Event Publishing
**Source:** `packages/mcp-server/src/daemon/server.js` lines 139-144
**Apply to:** All new SSE events (`daemon:tunnel-started`, `daemon:tunnel-stopped`, `daemon:tunnel-auto-disabled`)
```javascript
const publishEvent = (event, payload) => {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of sseClients) {
    response.write(frame);
  }
};
// Usage:
publishEvent('daemon:tunnel-started', { url });
publishEvent('daemon:tunnel-stopped', {});
publishEvent('daemon:tunnel-auto-disabled', { failures, windowMs, ip });
```

### requireBearer Pattern
**Source:** `packages/mcp-server/src/daemon/server.js` lines 118-127
**Apply to:** Both `POST /daemon/enable-tunnel` and `POST /daemon/disable-tunnel`
```javascript
app.post('/daemon/enable-tunnel', requireBearer, async (req, res, next) => { ... });
app.post('/daemon/disable-tunnel', requireBearer, async (_req, res, next) => { ... });
```

### Lockfile replace() for Atomic State Updates
**Source:** `packages/mcp-server/src/daemon/launcher.js` lines 294-295
**Apply to:** All tunnel URL updates in launcher.js
```javascript
replace(buildRecord(), { lockPath, expectedUuid: uuid });
// With tunnelUrl:
replace({ ...buildRecord(), tunnelUrl: state.url }, { lockPath, expectedUuid: uuid });
```

### DashboardProvider postResult Pattern
**Source:** `packages/extension/src/webview/DashboardProvider.ts` line 573
**Apply to:** All tunnel message handlers
```typescript
private postResult(id: string, ok: boolean, error?: string): void {
  this.view?.webview.postMessage({ type: 'action:result', id, ok, error });
}
```

### Error Handling — try/catch + next(err)
**Source:** `packages/mcp-server/src/daemon/server.js` lines 169-181 (`rotate-token`)
**Apply to:** All new HTTP endpoint handlers in server.js
```javascript
app.post('/daemon/enable-tunnel', requireBearer, async (req, res, next) => {
  try {
    // ... handler body ...
  } catch (err) { next(err); }
});
```

### LSP Subprocess Lifecycle (for cf-quick/cf-named tunnel process)
**Source:** `packages/mcp-server/src/daemon/launcher.js` lines 341-383
**Apply to:** Tunnel child process lifecycle in launcher.js
The cloudflared subprocess follows the same "spawn + error handler + exit handler + SIGTERM in finalize()" pattern as the LSP subprocess, but tunnel child is managed via `activeTunnel.stop()` (provider-owned) rather than direct `child.kill()`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/extension/package.json` command registration | config | — | No exact analog — command follows the `contributes.commands` array pattern seen for existing commands. Planner adds `airtableFormula.tunnel.disable` entry following existing command shape. |
| `packages/webview/src/store.ts` tunnel action additions | store | event-driven | No existing tunnel actions in store. Planner adds `enableTunnel`, `disableTunnel`, `setNgrokAuthtoken` following existing action pattern (e.g. `setupIde` calls `sendMessage` + `postResult` handler). |

---

## Metadata

**Analog search scope:** `packages/mcp-server/src/daemon/`, `packages/extension/src/webview/`, `packages/shared/src/`, `packages/webview/src/tabs/`, `C:\Users\admin\github-repos\VSCode-Perplexity-MCP\packages\mcp-server\src\daemon\`
**Files scanned:** 22
**Pattern extraction date:** 2026-05-15
