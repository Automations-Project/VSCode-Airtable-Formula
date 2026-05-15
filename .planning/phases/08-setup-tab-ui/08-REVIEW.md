---
phase: 08-setup-tab-ui
reviewed: 2026-05-15T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - packages/shared/src/types.ts
  - packages/webview/src/tabs/Setup.tsx
  - packages/webview/src/test/setup.test.tsx
  - packages/webview/src/test/store.test.ts
  - packages/extension/src/webview/DashboardProvider.ts
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-05-15T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

The security-critical requirements for this phase (T-08-01, T-08-02) are correctly implemented: `bearerToken` and `pid` are explicitly excluded from `DaemonStatusInfo` before it reaches the webview, and `getMcpSnippet()` uses the literal `{{BEARER_TOKEN}}` placeholder throughout all HTTP variants. The type contract in `DaemonStatusInfo` is sound and the comments correctly document the intent.

Two blockers were found. One is a race condition that can silently swallow user-initiated token saves (the `setNgrokAuthtoken` message is fired before `enableTunnel`, with no coordination, so a slow SecretStorage write may mean the enablement call reads a stale token). The other is a stale fallback `ToolProfileSnapshot` in `DashboardProvider.pushState()` that advertises `totalCount: 36` instead of the authoritative `62`, meaning a user who opens the dashboard before `ToolProfileManager` initializes sees a wrong tool count that also violates the `ToolCategories` interface (missing four required keys).

---

## Critical Issues

### CR-01: `setNgrokAuthtoken` fire-and-forget before `enableTunnel` — race condition drops new token

**File:** `packages/webview/src/tabs/Setup.tsx:224-227`

**Issue:** When the user enters a new ngrok authtoken and clicks Enable, `handleEnableTunnel` calls `setNgrokAuthtoken(ngrokAuthtokenInput)` and then immediately calls `enableTunnel(...)`. Both are fire-and-forget (no `await`). `setNgrokAuthtoken` sends `tunnel:set-ngrok-authtoken` to the extension, which writes the token to `SecretStorage` (an async operation). `enableTunnel` sends `tunnel:enable`, which the extension immediately handles by reading the token back from `SecretStorage`. Because the two messages are dispatched sequentially but processed concurrently in the extension, the `tunnel:enable` handler frequently reads from SecretStorage before the write from `tunnel:set-ngrok-authtoken` completes. In that case `authtoken` is `undefined` at line 419 of `DashboardProvider.ts`, the guard at line 418 falls through, and the tunnel starts without any authentication.

The existing code comment at DashboardProvider line 416 (`// For ngrok: read authtoken from SecretStorage (T-07-21 — never rely on webview to pass it directly)`) reinforces the design intent that the extension always reads from SecretStorage, making this race real rather than theoretical.

**Fix:** Pass the authtoken directly in the `tunnel:enable` message (already an optional field in the protocol type at `messages.ts:34`) and have the extension handler use `msg.authtoken` as the authoritative value when non-empty, then store it, rather than requiring a prior separate store message:

```tsx
// Setup.tsx — handleEnableTunnel
const handleEnableTunnel = async () => {
  setIsTunnelPending(true);
  try {
    // Pass authtoken inline — extension stores it and uses it atomically
    const authtoken = (selectedProvider === 'ngrok' && ngrokAuthtokenInput)
      ? ngrokAuthtokenInput
      : undefined;
    enableTunnel(selectedProvider, authtoken, ngrokDomainInput || undefined);
  } finally {
    setIsTunnelPending(false);
  }
};
```

Then in `DashboardProvider.ts` `tunnel:enable` handler, update to store before using:
```ts
let authtoken: string | undefined = msg.authtoken;
if (msg.provider === 'ngrok') {
  if (authtoken) {
    await this.context.secrets.store('airtable-formula.ngrok.authtoken', authtoken);
  } else {
    authtoken = await this.context.secrets.get('airtable-formula.ngrok.authtoken') ?? undefined;
  }
}
```

---

### CR-02: Fallback `ToolProfileSnapshot` in `pushState()` has wrong counts and violates the `ToolCategories` interface

**File:** `packages/extension/src/webview/DashboardProvider.ts:479-490`

**Issue:** The hardcoded fallback object used when `toolProfileManager` is not yet wired has `enabledCount: 36` and `totalCount: 36`. The project's authoritative total is 62 tools (per CLAUDE.md: "Provides 62 tools"). Any user who opens the dashboard before `ToolProfileManager.init()` completes sees a count that is wrong by 26 tools.

More critically, the `categories` object is missing four keys that are required by the `ToolCategories` interface (defined in `types.ts:88-100`): `viewSection`, `viewSectionDestructive`, `formWrite`, and `toolManagement`-adjacent categories as defined. TypeScript will accept this at compile time only if the fallback literal is typed loosely. At runtime the webview will receive an object that does not satisfy the declared type contract, which can cause rendering bugs in any Settings component that iterates `Object.keys(categories)` expecting all 11 keys.

**Fix:**
```ts
const toolProfile: ToolProfileSnapshot = this.toolProfileManager?.getSnapshot() ?? {
  profile:      'full',
  enabledCount: 62,
  totalCount:   62,
  categories: {
    read: true,
    tableWrite: true,         tableDestructive: true,
    fieldWrite: true,         fieldDestructive: true,
    viewWrite: true,          viewDestructive: true,
    viewSection: true,        viewSectionDestructive: true,
    formWrite: true,
    extension: true,
  },
};
```

---

## Warnings

### WR-01: `setting:change` handler calls `postResult('', true)` — empty action ID breaks acknowledgement routing

**File:** `packages/extension/src/webview/DashboardProvider.ts:397`

**Issue:** The `setting:change` branch of `handleMessage` ends with `this.postResult('', true)`. The `setting:change` message type does not carry an `id` field in the protocol (`messages.ts:27`), so the handler cannot echo back a real action ID. However, the `action:result` message the webview receives will have `id: ''`. If the store's `markActionDone` logic ever looks up `''` in `pendingActions`, it will silently no-op (since no action was added under that ID). This is harmless today because `setting:change` dispatches do not add to `pendingActions`, but it is a type contract violation (`action:result` declares `id: string` implying a valid correlator) and will cause confusion for any future code that tries to match results.

**Fix:** Either omit the `postResult` call entirely for `setting:change` (since the webview does not register a pending action for it), or add an `id` field to the `setting:change` protocol message:
```ts
// Option A — simplest: just don't post a result for a fire-and-forget setting
// (remove line 397)

// Option B — add id to the protocol
| { type: 'setting:change'; id: string; key: string; value: unknown }
```

---

### WR-02: `isTunnelPending` is reset to `false` synchronously before the async extension round-trip completes

**File:** `packages/webview/src/tabs/Setup.tsx:221-240`

**Issue:** Both `handleEnableTunnel` and `handleDisableTunnel` are declared `async` but the calls inside them (`enableTunnel(...)`, `disableTunnel()`) are fire-and-forget store actions that send a message and return immediately. The `finally` block therefore runs before the extension has done anything, setting `isTunnelPending` back to `false` essentially at the next microtask. The button label flicks from "Starting..." / "Stopping..." to the normal state immediately, providing no real user feedback. The `aria-busy` attribute is similarly misleading.

**Fix:** Either derive the pending state from the store's `pendingActions` (consistent with how IDE actions work), or keep `isTunnelPending` true until the `action:result` for the tunnel action is received:
```tsx
// Simplest: use store pendingActions instead of local state
const isTunnelPending = pendingActions.size > 0;
// (and remove the local useState + try/finally blocks)
```

---

### WR-03: `getLspSnippet` for `opencode` TCP variant includes `--stdio` in the command but also sets a TCP port — contradictory config

**File:** `packages/webview/src/tabs/Setup.tsx:108-121`

**Issue:** The OpenCode TCP snippet (lines 109-121) outputs a config that specifies both `"command": ["npx", "-y", "airtable-user-lsp", "--stdio"]` and an `"initialization": { "host": "127.0.0.1", "port": ... }` block. The `--stdio` flag directs the LSP server to use stdio transport, but the `initialization.port` key instructs the client to connect via TCP. These two directives contradict each other. An LSP server that starts in stdio mode will not listen on a TCP port; the client will time out attempting to connect. The correct TCP variant should omit `--stdio` (or use a `--tcp-server` flag) in the command and rely solely on the initialization block to set transport. The stdio variant correctly omits the initialization block.

This is not caught by any test — `setup.test.tsx` does not assert an OpenCode TCP snippet.

**Fix:**
```ts
// opencode TCP — server should listen on TCP, not stdio
return `{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "airtable-formula": {
      "command": ["npx", "-y", "airtable-user-lsp"],
      "extensions": [".formula", ".ats", ".ata"],
      "initialization": {
        "host": "127.0.0.1",
        "port": ${port}
      }
    }
  }
}`;
```

---

### WR-04: `formatUptime` passes through negative values and returns misleading output

**File:** `packages/webview/src/tabs/Setup.tsx:9-20`

**Issue:** If the daemon `uptime` value is negative (which can happen if the system clock is skewed, or if `startedAt` is in the future due to NTP sync), `formatUptime` will not catch it: the `ms < 60_000` guard is satisfied for any negative value, so it returns `'< 1m'` for a daemon that may not actually be running correctly. Additionally, `NaN` (which results if `Date.parse(record.startedAt)` fails) is not guarded. `NaN < 60_000` is `false`, so NaN flows into the `ms < 3_600_000` branch (also `false`), then to the hours branch where `Math.floor(NaN / ...)` produces `NaN`, and the returned string is `"NaNh NaNm"`.

No test covers `formatUptime(NaN)` or `formatUptime(-1)`.

**Fix:**
```ts
export function formatUptime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) return '< 1m';
  // ... rest unchanged
}
```

---

## Info

### IN-01: No test for `getLspSnippet` OpenCode TCP or stdio variants

**File:** `packages/webview/src/test/setup.test.tsx`

**Issue:** The `getLspSnippet` test suite covers neovim and zed TCP/stdio, but has zero coverage for the `opencode` IDE. This is the exact path that contains the contradictory `--stdio` + TCP port bug (WR-03).

**Fix:** Add test cases:
```ts
it('OpenCode TCP snippet does not include --stdio', () => {
  const text = getLspSnippet('opencode', 'tcp', 2087);
  expect(text).toContain('2087');
  expect(text).not.toContain('--stdio');
});
it('OpenCode stdio snippet does not contain initialization block', () => {
  const text = getLspSnippet('opencode', 'stdio', '{LSP_PORT}');
  expect(text).not.toContain('initialization');
});
```

---

### IN-02: `store.test.ts` `beforeEach` initialises `settings` without a `script` key — diverges from `defaultSettings`

**File:** `packages/webview/src/test/store.test.ts:11-26`

**Issue:** The `beforeEach` block in `store.test.ts` sets `settings` with keys `mcp`, `ai`, `formula`, `auth`, and `debug` but omits the `script` key that is present in `store.ts`'s `defaultSettings` (line 58: `script: { beautifyStyle: 'default', minifyLevel: 'standard' }`). The `SettingsSnapshot` type includes `script` as a required field. This means tests run against a store state that would be a TypeScript type error if the initialiser were typed strictly. If any tested code path reads `settings.script.*` it will throw at runtime during tests rather than being caught at compile time.

**Fix:** Add the missing `script` key to the `beforeEach` initializer:
```ts
script: { beautifyStyle: 'default', minifyLevel: 'standard' },
```

---

### IN-03: `console.error` calls left in production `DashboardProvider.ts`

**File:** `packages/extension/src/webview/DashboardProvider.ts:724, 739`

**Issue:** Two `console.error` calls remain in production code paths: one in `rewriteConfiguredIdeMcpEntries` (line 724) and one in `readBundledMcpVersion` (line 739). In the VS Code extension host, these go to the Output panel only when the user has developer tools open. They are not routed through the `DebugCollector` tracing system that the rest of the extension uses. This produces inconsistent observability.

**Fix:** Route through `_debugCollector?.trace(...)` (using the `error` category if one exists) or the VS Code output channel, consistent with other error paths in the extension.

---

_Reviewed: 2026-05-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
