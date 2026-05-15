# Phase 8: Setup Tab UI — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 5 (3 modify, 1 create, 1 extend)
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/shared/src/types.ts` | type/model | — | `TunnelState` / `TunnelProviderId` in same file (lines 147–175) | exact |
| `packages/extension/src/webview/DashboardProvider.ts` | provider/host | request-response | `_computeTunnelState()` in same file (lines 610–674) | exact |
| `packages/webview/src/tabs/Setup.tsx` | component | request-response | existing Tunnel panel + `handleCopyUrl`/`setCopiedUrl` in same file | exact |
| `packages/webview/src/test/setup.test.tsx` (CREATE) | test | — | `packages/webview/src/test/store.test.ts` (entire file) | role-match |
| `packages/webview/src/test/store.test.ts` (EXTEND) | test | — | existing `applyState` test block in same file (lines 33–44) | exact |

---

## Pattern Assignments

### `packages/shared/src/types.ts` — add `DaemonStatusInfo` + `daemon?` field

**Analog:** `TunnelState` / `TunnelProviderId` block in the same file (lines 147–175).

**Type union pattern** (lines 147–149):
```typescript
export type TunnelProviderId = 'cf-quick' | 'ngrok' | 'cf-named';
export type TunnelStatus = 'disabled' | 'starting' | 'active' | 'auto-disabled' | 'error';
```

**Interface with nullable fields + optional sub-object** (lines 157–163):
```typescript
export interface TunnelState {
  status:             TunnelStatus;
  url:                string | null;
  provider:           TunnelProviderId;
  ngrokAuthtokenSet:  boolean;
  autoDisabledReason: TunnelAutoDisabledReason | null;
}
```

**Addition to `DashboardState`** (line 174):
```typescript
tunnel?:      TunnelState;  // undefined when daemon is not running
```

**New interface to add** — place after `TunnelState` definition, before `DashboardState`:
```typescript
export interface DaemonStatusInfo {
  running:   boolean;
  healthy:   boolean;         // result of /daemon/health HTTP check
  port:      number | null;   // MCP HTTP port
  port_lsp:  number | null;   // LSP TCP port — null when LSP not started
  tunnelUrl: string | null;   // active tunnel URL or null
  uptime:    number | null;   // milliseconds since daemon startedAt, or null
}
```

**Addition to `DashboardState`** — place after `tunnel?` line:
```typescript
daemon?:      DaemonStatusInfo;  // undefined when daemon is not running
```

**Notes:**
- `DaemonStatus` in `daemon-manager.ts` (lines 6–15) has `pid` and `bearerToken` — DO NOT include either in `DaemonStatusInfo`. These fields must never reach the webview (D-07).
- Do NOT import from `packages/extension` in shared — `DaemonStatusInfo` must be a standalone interface copied from the safe subset of `DaemonStatus` fields.
- Field names must match `DaemonStatus` exactly (`port_lsp` not `portLsp`) so the mapping in `_computeDaemonStatusInfo()` is a direct property copy.

---

### `packages/extension/src/webview/DashboardProvider.ts` — add `_computeDaemonStatusInfo()`

**Analog:** `_computeTunnelState()` private method, lines 610–674 (same file).

**Private async method signature** (line 610):
```typescript
private async _computeTunnelState(): Promise<import('@airtable-formula/shared').TunnelState | undefined> {
```

**Try/catch with undefined fallback** (lines 611, 673–674):
```typescript
try {
  // ... computation ...
  return { status, url: tunnelUrl, provider, ngrokAuthtokenSet, autoDisabledReason };
} catch {
  return undefined;
}
```

**Pattern to copy for `_computeDaemonStatusInfo()`:**
```typescript
private async _computeDaemonStatusInfo(): Promise<import('@airtable-formula/shared').DaemonStatusInfo | undefined> {
  try {
    const status = await this._daemonManager?.getDaemonStatus();
    if (!status?.running) return undefined;
    return {
      running:   status.running,
      healthy:   status.healthy,
      port:      status.port,
      port_lsp:  status.port_lsp,
      tunnelUrl: status.tunnelUrl,
      uptime:    status.uptime,
      // bearerToken and pid intentionally excluded (D-07)
    };
  } catch {
    return undefined;
  }
}
```

**Addition to `pushState()` state object** (line 534 is where `tunnel:` is set):
```typescript
tunnel: await this._computeTunnelState(),
daemon: await this._computeDaemonStatusInfo(),
```

**Import for `DaemonStatusInfo`** — already imported via `import type { DashboardState, ... } from '@airtable-formula/shared'` (line 4); `DaemonStatusInfo` must be added to that import list.

**Notes:**
- `this._daemonManager` is already injected via `setDaemonManager()` (lines 42–46) — no new injection needed.
- Method placement: add immediately after `_computeTunnelState()` (after line 674) to keep all `_compute*` helpers grouped together.
- The `getDaemonStatus()` call is already used elsewhere in this file (e.g., lines 411, 437) — same pattern, no special handling needed.

---

### `packages/webview/src/tabs/Setup.tsx` — add three new panels

**Analog:** The existing Tunnel panel in the same file (lines 63–217) plus `handleCopyUrl`/`setCopiedUrl` (lines 44–50, 17).

**Panel structure** — all panels follow the same glass-panel + section-header + content layout (lines 63–69):
```tsx
<div className="glass-panel">
  <div className="section-header">
    <div className="eyebrow">Remote Access</div>
    <div className="title">Tunnel</div>
    <div className="detail">{tunnelDetail}</div>
  </div>
  {/* panel body */}
</div>
```

**Status chip pattern** (lines 72–80):
```tsx
{tunnel && (
  <div style={{ marginBottom: 8 }}>
    {tunnel.status === 'active' && <span className="chip chip-ok">Active</span>}
    {tunnel.status === 'disabled' && <span className="chip chip-muted">Disabled</span>}
    {tunnel.status === 'starting' && <span className="chip chip-info">Starting...</span>}
    {tunnel.status === 'auto-disabled' && <span className="chip chip-warn">Auto-disabled</span>}
    {tunnel.status === 'error' && <span className="chip chip-err">Error</span>}
  </div>
)}
```

**list-row key-value row** (lines 179–190):
```tsx
<div className="list-row" style={{ marginBottom: 8, alignItems: 'center', gap: 8 }}>
  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', flex: 1, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
    {tunnel.url}
  </span>
  <button className="btn btn-ghost btn-sm" aria-label="Copy tunnel URL" onClick={handleCopyUrl}>
    {copiedUrl ? 'Copied!' : 'Copy'}
  </button>
</div>
```

**Copy-to-clipboard local state + handler** (lines 17, 44–50):
```tsx
const [copiedUrl, setCopiedUrl] = React.useState(false);

const handleCopyUrl = () => {
  if (tunnel?.url) {
    navigator.clipboard.writeText(tunnel.url).catch(() => undefined);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1500);
  }
};
```

**New state to add** — generalized multi-key version for snippet panels:
```tsx
const [copiedKeys, setCopiedKeys] = React.useState<Record<string, boolean>>({});
const handleCopySnippet = (text: string, key: string) => {
  navigator.clipboard.writeText(text).catch(() => undefined);
  setCopiedKeys(k => ({ ...k, [key]: true }));
  setTimeout(() => setCopiedKeys(k => ({ ...k, [key]: false })), 1500);
};
```

**New tab state pairs** (two independent pairs, one per snippet section):
```tsx
const [mcpActiveIde, setMcpActiveIde] = React.useState('claude-code');
const [mcpActiveVariant, setMcpActiveVariant] = React.useState<'http' | 'stdio'>('http');
const [lspActiveIde, setLspActiveIde] = React.useState('claude-code');
const [lspActiveVariant, setLspActiveVariant] = React.useState<'tcp' | 'stdio'>('tcp');
```

**Store destructure** — add `daemon` to the existing `useStore()` call (line 6):
```tsx
const { ideStatuses, ..., tunnel, ..., daemon } = useStore();
```

**Port placeholder pattern** (from RESEARCH.md, Pattern 4):
```tsx
const mcpPort = daemon?.port ?? '{MCP_PORT}';
const lspPort = daemon?.port_lsp ?? '{LSP_PORT}';
```

**Pure helper functions to export** (for testability — place before the `Setup` function or in a sibling utils module):
```tsx
export function formatUptime(ms: number | null): string {
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

export function getMcpSnippet(ide: string, variant: 'http' | 'stdio', port: number | string): string {
  // Returns the entry-block JSON string for the given IDE + variant
  // port is live number when daemon running, or '{MCP_PORT}' string when not
}

export function getLspSnippet(ide: string, variant: 'tcp' | 'stdio', port: number | string): string {
  // Returns the config block string for the given IDE + variant
  // port is live number when daemon running, or '{LSP_PORT}' string when not
}
```

**Outer IDE tab bar pattern** (from UI-SPEC component spec):
```tsx
<div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, gap: 0 }}>
  {IDE_TABS.map(ide => (
    <button
      key={ide.id}
      role="tab"
      aria-selected={mcpActiveIde === ide.id}
      onClick={() => setMcpActiveIde(ide.id)}
      style={{
        padding: '8px 12px', fontSize: '0.7rem',
        fontWeight: mcpActiveIde === ide.id ? 600 : 500,
        color: mcpActiveIde === ide.id ? 'var(--fg)' : 'var(--fg-muted)',
        borderBottom: `2px solid ${mcpActiveIde === ide.id ? 'var(--at-blue)' : 'transparent'}`,
        background: 'none', border: 'none', borderBottomStyle: 'solid', borderBottomWidth: 2,
        cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: 0,
        transition: 'color 120ms ease, border-color 120ms ease',
      }}
    >{ide.label}</button>
  ))}
</div>
```

**Snippet code block with absolute copy button** (from UI-SPEC):
```tsx
<div style={{ position: 'relative' }}>
  <pre style={{
    background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', padding: '8px 12px',
    fontFamily: 'var(--font-mono)', fontSize: '0.7rem', lineHeight: 1.5,
    color: 'var(--fg)', overflowX: 'auto', whiteSpace: 'pre', margin: 0,
  }}>
    <code>{snippetText}</code>
  </pre>
  <button
    className="btn btn-ghost btn-sm"
    onClick={() => handleCopySnippet(snippetText, copyKey)}
    aria-label="Copy snippet"
    style={{ position: 'absolute', top: 8, right: 8 }}
  >
    {copiedKeys[copyKey] ? 'Copied!' : 'Copy snippet'}
  </button>
</div>
```

**Panel insertion order** — the outer `<div className="stack stack-lg">` (line 61) already wraps all panels. Insert:
1. Daemon Status block — as the first child (before existing Tunnel panel at line 64)
2. MCP Snippets panel — after the last existing IDE panel (`ideStatuses.length === 0` empty state, line 283)
3. LSP Snippets panel — after MCP Snippets

**Notes:**
- The existing `useStore()` destructure is on line 6 — add `daemon` to it, do not create a second `useStore()` call.
- `formatUptime`, `getMcpSnippet`, and `getLspSnippet` must be exported named functions (not closures inside the component) so `setup.test.tsx` can import and test them without rendering the full component.
- Inner variant sub-tab buttons use `padding: '4px 8px'` (tighter than outer IDE tab `'8px 12px'`).
- Copy key format: `mcp-{ide-id}-{variant}` and `lsp-{ide-id}-{variant}` e.g. `mcp-claude-code-http`, `lsp-neovim-tcp`.
- Daemon status block visibility guard: `{daemon?.running && (<div className="glass-panel">...</div>)}` — no offline placeholder (D-01).
- Snippet panels (MCP and LSP) are always rendered regardless of daemon state — only the daemon status block is conditionally hidden.
- Health chip for daemon: `daemon.healthy ? <span className="chip chip-ok">Healthy</span> : <span className="chip chip-warn">Degraded</span>` — no other chip variants for daemon.
- Per-IDE HTTP key differences (Pitfall 2 in RESEARCH.md): Claude Code + Claude Desktop use `"type": "http"` + `"url"`, Cursor + Cline use `"url"` only, Windsurf uses `"serverUrl"`.

---

### `packages/webview/src/test/setup.test.tsx` (CREATE)

**Analog:** `packages/webview/src/test/store.test.ts` (entire file — lines 1–75).

**Test file header + vi.mock pattern** (lines 1–9):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/vscode.js', () => ({
  sendToExtension: vi.fn(),
  onExtensionMessage: vi.fn(() => () => {}),
}));

import { useStore } from '../store.js';
import { sendToExtension } from '../lib/vscode.js';
```

**For setup.test.tsx — import the pure helpers and test them directly** (no `@testing-library/react` — it is not in devDependencies):
```typescript
import { describe, it, expect } from 'vitest';
import { formatUptime, getMcpSnippet, getLspSnippet } from '../tabs/Setup.js';
```

**Pure-function test style** (lines 28–75):
```typescript
describe('formatUptime', () => {
  it('returns — for null', () => {
    expect(formatUptime(null)).toBe('—');
  });
  it('returns < 1m for less than 60 seconds', () => {
    expect(formatUptime(30_000)).toBe('< 1m');
  });
  it('returns Nm Ss for minutes range', () => {
    expect(formatUptime(2 * 60_000 + 30_000)).toBe('2m 30s');
  });
  it('returns Hh Mm for hours range', () => {
    expect(formatUptime(2 * 3_600_000 + 15 * 60_000)).toBe('2h 15m');
  });
});

describe('getMcpSnippet', () => {
  it('HTTP snippet contains {{BEARER_TOKEN}} placeholder — never a real token', () => {
    const text = getMcpSnippet('claude-code', 'http', 3100);
    expect(text).toContain('{{BEARER_TOKEN}}');
  });
  it('HTTP snippet contains live port when daemon is running', () => {
    const text = getMcpSnippet('cursor', 'http', 3100);
    expect(text).toContain('3100');
  });
  it('HTTP snippet contains {MCP_PORT} placeholder when port is a string', () => {
    const text = getMcpSnippet('cursor', 'http', '{MCP_PORT}');
    expect(text).toContain('{MCP_PORT}');
    expect(text).not.toContain('undefined');
  });
  it('stdio snippet does not contain a port', () => {
    const text = getMcpSnippet('cursor', 'stdio', '{MCP_PORT}');
    expect(text).toContain('airtable-user-mcp');
    expect(text).not.toContain('127.0.0.1');
  });
});
```

**Notes:**
- Do NOT use `@testing-library/react` — it is not in webview devDependencies and the existing test style is pure-function only.
- Tests for daemon block visibility (`daemon?.running === false` hides block) can be pure logic tests against the helper output, or simple boolean checks — no JSX rendering required.
- Test file must be `.tsx` (not `.ts`) only if JSX is used; if all tests are pure-function imports, `.ts` is fine.
- The `vi.mock('../lib/vscode.js', ...)` block is only needed if the test file imports anything that transitively imports `vscode.js`. For a test file that only imports `formatUptime`, `getMcpSnippet`, `getLspSnippet` from `Setup.tsx`, the mock may be required if `Setup.tsx` imports from `store.js` at module level. Safest: include the mock as a precaution.

---

### `packages/webview/src/test/store.test.ts` (EXTEND)

**Analog:** existing `applyState` test at lines 33–44 (same file).

**`beforeEach` reset block** (lines 11–24) — must add `daemon: undefined`:
```typescript
beforeEach(() => {
  useStore.setState({
    ideStatuses: [], versions: { extension: '—', mcpServerBundled: '—' }, aiFilesCount: 0, loading: true,
    activeTab: 'overview', pendingActions: new Set(),
    settings: { /* ... existing ... */ },
    auth: { status: 'unknown', hasCredentials: false },
    daemon: undefined,  // ADD THIS LINE
  });
  vi.clearAllMocks();
});
```

**New test to add** — `applyState` with daemon field (matching lines 33–44 style):
```typescript
it('applyState with daemon field populates store.daemon', () => {
  useStore.getState().applyState({
    ideStatuses: [], versions: { extension: '2.0.10', mcpServerBundled: '2.1.0' },
    aiFilesCount: 0, loading: false,
    settings: { mcp: { autoConfigureOnInstall: true, notifyOnUpdates: true }, ai: { autoInstallFiles: true, includeAgents: false }, formula: { formatterVersion: 'v2' } },
    daemon: { running: true, healthy: true, port: 3100, port_lsp: 2087, tunnelUrl: null, uptime: 90_000 },
  });
  expect(useStore.getState().daemon?.port).toBe(3100);
  expect(useStore.getState().daemon?.healthy).toBe(true);
});

it('applyState with daemon undefined leaves daemon undefined', () => {
  useStore.getState().applyState({
    ideStatuses: [], versions: { extension: '2.0.10', mcpServerBundled: '2.1.0' },
    aiFilesCount: 0, loading: false,
    settings: { mcp: { autoConfigureOnInstall: true, notifyOnUpdates: true }, ai: { autoInstallFiles: true, includeAgents: false }, formula: { formatterVersion: 'v2' } },
  });
  expect(useStore.getState().daemon).toBeUndefined();
});
```

**Notes:**
- The existing `applyState` test (lines 33–44) passes a partial state object — this is intentional; the spread in `applyState` handles missing fields. New tests can follow the same partial-state pattern.
- `beforeEach` reset MUST include `daemon: undefined` to avoid state bleed between tests after `DashboardState` gains the new field. This is documented as Pitfall 5 in RESEARCH.md.

---

## Shared Patterns

### glass-panel + section-header
**Source:** `packages/webview/src/tabs/Setup.tsx` lines 63–69 (Tunnel panel), 220–227 (Summary panel), 242–247 (Detected IDEs panel)
**Apply to:** All three new panels in Setup.tsx
```tsx
<div className="glass-panel">
  <div className="section-header">
    <div className="eyebrow">{eyebrowText}</div>
    <div className="title">{titleText}</div>
    <div className="detail">{detailText}</div>
  </div>
  {/* panel body */}
</div>
```

### chip variants
**Source:** `packages/webview/src/tabs/Setup.tsx` lines 74–79
**Apply to:** Daemon health chip
- `chip-ok` — healthy state
- `chip-warn` — degraded state
- `chip-muted` — disabled (existing use)
- `chip-info` — starting (existing use)
- `chip-err` — error (existing use)

### list-row key-value display
**Source:** `packages/webview/src/tabs/Setup.tsx` lines 179–190
**Apply to:** MCP Port, LSP Port, Tunnel URL, Uptime rows in daemon status block
```tsx
<div className="list-row">
  <span style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', flex: 1 }}>{label}</span>
  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{value}</span>
</div>
```

### Copy-to-clipboard
**Source:** `packages/webview/src/tabs/Setup.tsx` lines 44–50 (`handleCopyUrl`)
**Apply to:** All snippet copy buttons (generalized to `handleCopySnippet` with a key map)

### `optional?: field` in DashboardState
**Source:** `packages/shared/src/types.ts` lines 172–174 (`debug?`, `storage?`, `tunnel?`)
**Apply to:** `daemon?: DaemonStatusInfo` addition

### Private `_compute*` async methods
**Source:** `packages/extension/src/webview/DashboardProvider.ts` lines 540–674 (`_computeStorageInfo`, `_computeTunnelState`)
**Apply to:** New `_computeDaemonStatusInfo()` method

---

## No Analog Found

None — all five files have strong direct analogs in the codebase.

---

## Metadata

**Analog search scope:** `packages/shared/src/`, `packages/extension/src/webview/`, `packages/webview/src/tabs/`, `packages/webview/src/test/`, `packages/extension/src/mcp/`
**Files scanned:** 7 (types.ts, DashboardProvider.ts, Setup.tsx, store.ts, store.test.ts, daemon-manager.ts, 08-UI-SPEC.md)
**Pattern extraction date:** 2026-05-15
