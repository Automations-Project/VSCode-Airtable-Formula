# Auth Security Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zero-credential manual login mode, storage/security transparency, encrypted backup/restore, file permission hardening, and user-selectable browser choice to the VS Code Airtable Formula extension.

**Architecture:** Four workstreams: (1) Auth core — types, settings, AuthManager, MCP script changes, migration, credential suppression. (2) Browser/config propagation — browser detection/selection, external IDE config rewrites. (3) Storage/security UX — Storage & Data panel, backup/restore with encryption, secure permissions. (4) Packaging/tests — bundling, VSIX deps, regression coverage. Workstreams 2-3 depend on 1 for shared types. Workstream 4 is last.

**Tech Stack:** TypeScript (extension), JavaScript (MCP scripts), React 19 + Zustand 5 (webview), Vite 6 (webview build), tsup (extension build), esbuild (MCP bundle), vitest (tests), Node crypto/zlib (encryption/zip), archiver/adm-zip (zip I/O).

**Spec:** `docs/superpowers/specs/2026-04-14-auth-security-upgrade-design.md`

---

## Phase 1: Auth Core

### Task 1: Shared Types — New interfaces and type extensions

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add BrowserChoice interface**

After the `BrowserInfo` interface (line 27), add:

```typescript
export interface BrowserChoice {
  mode: 'auto' | 'custom';
  channel?: string;
  executablePath?: string;
  label?: string;
}
```

- [ ] **Step 2: Add StorageEntry and StorageInfo interfaces**

After `BrowserDownloadState` (line 35), add:

```typescript
export interface StorageEntry {
  label:      string;
  path:       string;
  sizeBytes?: number;
  exists:     boolean;
}

export interface StorageInfo {
  entries: StorageEntry[];
}
```

- [ ] **Step 3: Extend AuthState with new fields**

Add to the `AuthState` interface (currently lines 37-46):

```typescript
export interface AuthState {
  status:             AuthStatus;
  userId?:            string;
  lastChecked?:       string;
  lastLogin?:         string;
  error?:             string;
  hasCredentials:     boolean;
  browser?:           BrowserInfo;
  browserDownload?:   BrowserDownloadState;
  availableBrowsers?: BrowserInfo[];    // NEW — all detected browsers
  browserChoice?:     BrowserChoice;    // NEW — user's selection
}
```

- [ ] **Step 4: Extend SettingsSnapshot.auth**

Update the `auth` field in `SettingsSnapshot` (line 96):

```typescript
auth:    {
  autoRefresh: boolean;
  refreshIntervalHours: number;
  loginMode: 'manual' | 'auto';
  browserChoice?: BrowserChoice;
};
```

- [ ] **Step 5: Add storage to DashboardState**

Add to `DashboardState` (line 115):

```typescript
export interface DashboardState {
  ideStatuses:  IdeStatus[];
  versions:     VersionInfo;
  aiFilesCount: number;
  loading:      boolean;
  settings:     SettingsSnapshot;
  auth:         AuthState;
  debug?:       DebugState;
  storage?:     StorageInfo;  // NEW
}
```

- [ ] **Step 6: Build shared package to verify types compile**

Run: `pnpm -F shared build`
Expected: Clean build, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add BrowserChoice, StorageInfo types; extend AuthState and SettingsSnapshot"
```

---

### Task 2: Shared Messages — New message types

**Files:**
- Modify: `packages/shared/src/messages.ts`

- [ ] **Step 1: Add new WebviewMessage variants**

Add these to the `WebviewMessage` union (after line 26):

```typescript
  | { type: 'action:manualLogin';        id: string }
  | { type: 'action:openStoragePath';    id: string; path: string }
  | { type: 'action:backupSession';      id: string }
  | { type: 'action:restoreSession';     id: string }
  | { type: 'action:selectCustomBrowser'; id: string }
  | { type: 'action:setBrowserChoice';   id: string; choice: import('./types.js').BrowserChoice }
```

- [ ] **Step 2: Build shared to verify**

Run: `pnpm -F shared build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/messages.ts
git commit -m "feat(shared): add message types for manual login, storage, backup, browser choice"
```

---

### Task 3: Extension Settings — loginMode and browserChoice

**Files:**
- Modify: `packages/extension/src/settings.ts`
- Modify: `packages/extension/package.json`

- [ ] **Step 1: Add loginMode and browserChoice to Settings interface**

In `packages/extension/src/settings.ts`, update the `Settings` interface (line 9) and `getSettings()` (lines 30-33):

```typescript
// In Settings interface:
auth: {
  autoRefresh: boolean;
  refreshIntervalHours: number;
  loginMode: 'manual' | 'auto';
  browserChoice?: { mode: 'auto' | 'custom'; channel?: string; executablePath?: string; label?: string };
};
```

```typescript
// In getSettings(), auth block:
auth: {
  autoRefresh:           cfg.get('auth.autoRefresh', true),
  refreshIntervalHours:  cfg.get('auth.refreshIntervalHours', 12),
  loginMode:             cfg.get('auth.loginMode', 'manual') as 'manual' | 'auto',
  browserChoice:         cfg.get('auth.browserChoice', undefined),
},
```

- [ ] **Step 2: Register settings in package.json contributes.configuration**

In `packages/extension/package.json`, in the `contributes.configuration.properties` section (after `auth.refreshIntervalHours` around line 231), add:

```json
"airtableFormula.auth.loginMode": {
  "type": "string",
  "enum": ["manual", "auto"],
  "default": "manual",
  "description": "Login mode: 'manual' opens a browser for you to log in, 'auto' uses stored credentials for automated login."
},
"airtableFormula.auth.browserChoice": {
  "type": "object",
  "default": { "mode": "auto" },
  "description": "Browser selection for authentication. Set via the dashboard UI.",
  "properties": {
    "mode": { "type": "string", "enum": ["auto", "custom"] },
    "channel": { "type": "string" },
    "executablePath": { "type": "string" },
    "label": { "type": "string" }
  }
}
```

- [ ] **Step 3: Build extension to verify**

Run: `pnpm -F airtable-formula build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/settings.ts packages/extension/package.json
git commit -m "feat(extension): add auth.loginMode and auth.browserChoice settings"
```

---

### Task 4: Profile Path Canonicalization — MCP scripts

**Files:**
- Modify: `packages/mcp-server/src/auth.js` (line 6)
- Modify: `packages/mcp-server/src/login-runner.js` (line 74)
- Modify: `packages/mcp-server/src/health-check.js` (line 27)
- Modify: `packages/mcp-server/src/login.js` (line 64)
- Modify: `packages/mcp-server/src/cli.js` (lines 99-108)

- [ ] **Step 1: Update auth.js profile path resolution**

In `packages/mcp-server/src/auth.js`, replace line 6:

```javascript
// OLD:
const DEFAULT_PROFILE_DIR = path.join(__dirname, '..', process.env.AIRTABLE_PROFILE || '.chrome-profile');

// NEW:
import os from 'os';
const DEFAULT_PROFILE_DIR = process.env.AIRTABLE_PROFILE_DIR
  || path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');
```

- [ ] **Step 2: Update login-runner.js profile path resolution**

In `packages/mcp-server/src/login-runner.js`, replace line 74:

```javascript
// OLD:
const profileDir = path.join(__dirname, '..', process.env.AIRTABLE_PROFILE || '.chrome-profile');

// NEW:
import os from 'os';
// (at top, after other imports)

// (inside main(), replace line 74)
const profileDir = process.env.AIRTABLE_PROFILE_DIR
  || path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');
```

- [ ] **Step 3: Update health-check.js profile path resolution**

In `packages/mcp-server/src/health-check.js`, replace line 27:

```javascript
// OLD:
const profileDir = path.join(__dirname, '..', process.env.AIRTABLE_PROFILE || '.chrome-profile');

// NEW:
import os from 'os';
const profileDir = process.env.AIRTABLE_PROFILE_DIR
  || path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');
```

- [ ] **Step 4: Update login.js (interactive CLI) profile path resolution**

In `packages/mcp-server/src/login.js`, replace line 64 in `parseArgs()`:

```javascript
// OLD:
profileDir: path.join(__dirname, '..', opts.profile || '.chrome-profile'),

// NEW:
profileDir: opts.profile
  ? path.resolve(opts.profile)
  : (process.env.AIRTABLE_PROFILE_DIR || path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile')),
```

Add `import os from 'os';` at the top if not already imported.

- [ ] **Step 5: Update cli.js logout to delete .chrome-profile directory**

In `packages/mcp-server/src/cli.js`, replace the logout handler (lines 99-108):

```javascript
if (cmd === 'logout') {
  const fs = await import('node:fs/promises');
  const profileDir = process.env.AIRTABLE_PROFILE_DIR
    || path.join(getConfigDir(), '.chrome-profile');
  try {
    await fs.rm(profileDir, { recursive: true, force: true });
    process.stdout.write('Browser session cleared.\n');
  } catch {
    process.stdout.write('No session to clear.\n');
  }
  // Also remove legacy session.json if it exists
  try {
    await fs.unlink(path.join(getConfigDir(), 'session.json'));
  } catch {
    // ignore
  }
  return true;
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/src/auth.js packages/mcp-server/src/login-runner.js packages/mcp-server/src/health-check.js packages/mcp-server/src/login.js packages/mcp-server/src/cli.js
git commit -m "feat(mcp-server): canonicalize profile path to ~/.airtable-user-mcp/.chrome-profile/"
```

---

### Task 5: Manual Login Runner — New MCP script

**Files:**
- Create: `packages/mcp-server/src/manual-login-runner.js`

- [ ] **Step 1: Create the manual-login-runner script**

Create `packages/mcp-server/src/manual-login-runner.js`:

```javascript
#!/usr/bin/env node
/**
 * Manual login runner — opens a visible browser for the user to log in.
 *
 * No credentials are passed. The user types email/password/2FA themselves.
 * Browser autofill from the persistent profile may pre-fill fields.
 *
 * Environment variables:
 *   AIRTABLE_PROFILE_DIR       — (optional) absolute profile path
 *   AIRTABLE_BROWSER_CHANNEL   — (optional) patchright channel
 *   AIRTABLE_BROWSER_PATH      — (optional) browser executable path
 *
 * Stdout JSON:
 *   { "ok": true,  "userId": "usrXXX" }
 *   { "ok": false, "error": "..." }
 */
import path from 'path';
import os from 'os';

const profileDir = process.env.AIRTABLE_PROFILE_DIR
  || path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');
const browserChannel = process.env.AIRTABLE_BROWSER_CHANNEL || 'chrome';
const browserPath = process.env.AIRTABLE_BROWSER_PATH || undefined;

let _chromium = null;
async function getChromium() {
  if (_chromium) return _chromium;
  try {
    const mod = await import('patchright');
    _chromium = mod.chromium;
    return _chromium;
  } catch (err) {
    throw new Error(
      'Browser automation requires patchright. Run `npx airtable-user-mcp install-browser` to set it up.\n' +
      `Original error: ${err.message}`
    );
  }
}

function output(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

async function main() {
  let context;
  try {
    console.error(`[manual-login] Launching visible ${browserChannel}...`);
    console.error(`[manual-login] Profile: ${profileDir}`);

    const launchOpts = {
      headless: false,
      channel: browserChannel,
      viewport: null,
    };
    if (browserPath) launchOpts.executablePath = browserPath;

    const chromium = await getChromium();
    context = await chromium.launchPersistentContext(profileDir, launchOpts);

    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://airtable.com/login', { waitUntil: 'domcontentloaded' });

    console.error('[manual-login] Browser opened. Waiting for user to log in...');

    // Poll for authentication (5-minute timeout)
    let loggedIn = false;
    let userId = null;
    const maxAttempts = 150; // 150 * 2s = 300s = 5 minutes

    for (let i = 0; i < maxAttempts; i++) {
      await page.waitForTimeout(2000);
      try {
        const result = await page.evaluate(async () => {
          try {
            const res = await fetch('/v0.3/getUserProperties', {
              headers: {
                'x-airtable-inter-service-client': 'webClient',
                'x-requested-with': 'XMLHttpRequest',
              },
            });
            if (res.ok) {
              const data = await res.json();
              return { ok: true, userId: data?.data?.userId };
            }
            return { ok: false, status: res.status };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        });

        if (result.ok) {
          loggedIn = true;
          userId = result.userId;
          break;
        }
      } catch {
        // Page navigating, keep waiting
      }
    }

    if (loggedIn) {
      console.error(`[manual-login] Login verified! User: ${userId}`);
      output({ ok: true, userId });
    } else {
      console.error('[manual-login] Login not detected after 5 minutes');
      output({ ok: false, error: 'Login not detected after 5 minutes' });
      process.exit(1);
    }
  } catch (e) {
    output({ ok: false, error: e.message });
    process.exit(1);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

main().catch(e => {
  output({ ok: false, error: e.message });
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp-server/src/manual-login-runner.js
git commit -m "feat(mcp-server): add manual-login-runner for zero-credential browser login"
```

---

### Task 6: Bundle Manual Login Runner

**Files:**
- Modify: `scripts/bundle-mcp.mjs`

- [ ] **Step 1: Add manual-login-runner entry point**

In `scripts/bundle-mcp.mjs`, after the `health-check.js` build call (around line 57), add a fourth build:

```javascript
// 4. Manual login runner (visible browser, no credentials)
await esbuild.build({
  ...sharedOptions,
  entryPoints: [path.join(mcpSrc, 'manual-login-runner.js')],
  outfile: path.join(outDir, 'manual-login-runner.mjs'),
});
```

- [ ] **Step 2: Build to verify**

Run: `pnpm build`
Expected: `dist/mcp/manual-login-runner.mjs` is created alongside the other three `.mjs` files.

- [ ] **Step 3: Commit**

```bash
git add scripts/bundle-mcp.mjs
git commit -m "build: bundle manual-login-runner.mjs in MCP build"
```

---

### Task 7: AuthManager — Login mode, manual login, logout, migration, timeout

**Files:**
- Modify: `packages/extension/src/mcp/auth-manager.ts`

- [ ] **Step 1: Add os and path imports, profile dir constant**

At the top of `auth-manager.ts`, add:

```typescript
import * as os from 'os';
```

Add a constant after the SECRET_ constants (line 14):

```typescript
const PROFILE_DIR = path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');
const CONFIG_DIR = path.join(os.homedir(), '.airtable-user-mcp');
```

- [ ] **Step 2: Add timeoutMs parameter to _spawnScript**

Update the `_spawnScript` signature (line 359) to accept an optional timeout:

```typescript
private _spawnScript(scriptName: string, extraEnv?: Record<string, string>, timeoutMs = 120_000): Promise<any> {
```

Update the timeout line (line 392) to use the parameter:

```typescript
const timeout = setTimeout(() => {
  child.kill('SIGTERM');
  reject(new Error(`${scriptName} timed out after ${Math.round(timeoutMs / 1000)}s`));
}, timeoutMs);
```

- [ ] **Step 3: Add _getLoginMode helper**

Add a private helper method to AuthManager:

```typescript
private _getLoginMode(): 'manual' | 'auto' {
  const cfg = vscode.workspace.getConfiguration('airtableFormula');
  return cfg.get('auth.loginMode', 'manual') as 'manual' | 'auto';
}
```

- [ ] **Step 4: Add _profileEnv helper**

Add a helper that returns the canonical profile dir env var:

```typescript
private _profileEnv(): Record<string, string> {
  return { AIRTABLE_PROFILE_DIR: PROFILE_DIR };
}
```

- [ ] **Step 5: Update login() to branch on loginMode**

Replace the `login()` method (lines 227-273):

```typescript
async login(): Promise<AuthState> {
  const probe = this.refreshBrowserDetection();
  if (!probe.found) {
    this._updateState({
      status: 'chrome-missing',
      error: 'No supported browser found. Install Google Chrome to enable Airtable authentication.',
    });
    return this._state;
  }

  const loginMode = this._getLoginMode();

  if (loginMode === 'auto') {
    const creds = await this.getCredentialsEnv();
    if (!creds) {
      this._updateState({ status: 'error', error: 'No credentials stored. Save credentials first.' });
      return this._state;
    }
    this._updateState({ status: 'logging-in' });
    try {
      const result = await this._spawnScript('login-runner.mjs', {
        ...creds, ...this._browserEnv(), ...this._profileEnv(),
      });
      const now = new Date().toISOString();
      if (result.ok) {
        this._updateState({ status: 'valid', userId: result.userId || undefined, lastLogin: now, lastChecked: now, error: undefined });
        await this._applyPermissions();
      } else {
        this._updateState({ status: 'error', lastChecked: now, error: result.error || 'Login failed' });
      }
    } catch (err) {
      this._updateState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  } else {
    // Manual mode — open visible browser, no credentials
    return this.manualLogin();
  }

  return this._state;
}
```

- [ ] **Step 6: Add manualLogin() method**

Add after `login()`:

```typescript
async manualLogin(): Promise<AuthState> {
  const probe = this.refreshBrowserDetection();
  if (!probe.found) {
    this._updateState({
      status: 'chrome-missing',
      error: 'No supported browser found. Install Google Chrome to enable Airtable authentication.',
    });
    return this._state;
  }

  this._updateState({ status: 'logging-in' });

  try {
    const result = await this._spawnScript(
      'manual-login-runner.mjs',
      { ...this._browserEnv(), ...this._profileEnv() },
      330_000, // 5.5 minutes — slightly longer than the script's 5-min poll
    );
    const now = new Date().toISOString();

    if (result.ok) {
      this._updateState({ status: 'valid', userId: result.userId || undefined, lastLogin: now, lastChecked: now, error: undefined });
      await this._applyPermissions();
    } else {
      this._updateState({ status: 'error', lastChecked: now, error: result.error || 'Login failed' });
    }
  } catch (err) {
    this._updateState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }

  return this._state;
}
```

- [ ] **Step 7: Update checkSession() to pass profile env**

In `checkSession()` (line 197), update the spawn call to include profile env:

```typescript
const result = await this._spawnScript('health-check.mjs', { ...this._browserEnv(), ...this._profileEnv() });
```

- [ ] **Step 8: Add logout() method — replaces clearCredentials() for UI use**

Add a new `logout()` method:

```typescript
async logout(): Promise<void> {
  // Clear SecretStorage credentials (if any)
  await this.secrets.delete(SECRET_EMAIL);
  await this.secrets.delete(SECRET_PASSWORD);
  await this.secrets.delete(SECRET_OTP_SECRET);

  // Delete browser profile directory
  const fs = await import('fs/promises');
  try {
    await fs.rm(PROFILE_DIR, { recursive: true, force: true });
    console.log('[AuthManager] Browser profile cleared');
  } catch (err) {
    console.warn('[AuthManager] Failed to clear browser profile:', err);
  }

  this._updateState({ status: 'unknown', hasCredentials: false, userId: undefined, error: undefined });
}
```

- [ ] **Step 9: Add _applyPermissions() stub**

Add a private stub that will be implemented in Task 12:

```typescript
private async _applyPermissions(): Promise<void> {
  // Implemented in secure-permissions.ts — wired up in a later task
  try {
    const { secureDirectory } = await import('./secure-permissions.js');
    await secureDirectory(CONFIG_DIR);
  } catch {
    // Permissions are best-effort — don't block login
  }
}
```

- [ ] **Step 10: Update _autoRefreshCycle() for manual mode expiry notification**

Replace `_autoRefreshCycle()` (lines 329-348):

```typescript
private async _autoRefreshCycle(): Promise<void> {
  if (this._disposed) return;
  if (this._state.status === 'logging-in' || this._state.status === 'checking') return;

  const probe = this.refreshBrowserDetection();
  if (!probe.found) return;

  const state = await this.checkSession();

  if (state.status === 'expired') {
    const loginMode = this._getLoginMode();
    if (loginMode === 'auto') {
      // Auto mode: attempt re-login with stored credentials
      const hasCreds = await this.hasCredentials();
      if (hasCreds) {
        console.log('[AuthManager] Session expired, attempting auto-login...');
        await this.login();
      }
    } else {
      // Manual mode: notify user, don't auto-login
      const action = await vscode.window.showWarningMessage(
        'Airtable session expired.',
        'Re-login in Browser',
      );
      if (action === 'Re-login in Browser') {
        void this.manualLogin();
      }
    }
  }
}
```

- [ ] **Step 11: Add migration logic to init()**

Update `init()` (lines 306-316):

```typescript
async init(): Promise<void> {
  // Migration: set loginMode for pre-update installs
  const cfg = vscode.workspace.getConfiguration('airtableFormula');
  const inspected = cfg.inspect('auth.loginMode');
  const isUnset = !inspected?.globalValue && !inspected?.workspaceValue && !inspected?.workspaceFolderValue;
  if (isUnset) {
    const hasCreds = await this.hasCredentials();
    const mode = hasCreds ? 'auto' : 'manual';
    await cfg.update('auth.loginMode', mode, vscode.ConfigurationTarget.Global);
    console.log(`[AuthManager] Migrated loginMode to '${mode}' (hasCreds=${hasCreds})`);
  }

  const hasCreds = await this.hasCredentials();
  const probe = this.refreshBrowserDetection();
  this._updateState({
    hasCredentials: hasCreds,
    ...(probe.found ? {} : { status: 'chrome-missing' as const }),
  });

  // Apply permissions on startup if profile exists
  await this._applyPermissions();

  this.startAutoRefresh();
}
```

- [ ] **Step 12: Build to verify**

Run: `pnpm -F airtable-formula build`
Expected: Build succeeds. The `secure-permissions.js` import will fail at runtime until Task 12, but the dynamic import won't break the build.

- [ ] **Step 13: Commit**

```bash
git add packages/extension/src/mcp/auth-manager.ts
git commit -m "feat(auth): add login mode branching, manual login, logout, migration, timeout"
```

---

### Task 8: Registration — Gate credential forwarding on loginMode

**Files:**
- Modify: `packages/extension/src/mcp/registration.ts`

- [ ] **Step 1: Import getSettings**

Add at the top of `registration.ts`:

```typescript
import { getSettings } from '../settings.js';
```

- [ ] **Step 2: Gate credential injection on loginMode**

In `registerMcpProvider()`, update the credential forwarding block (lines 67-77):

```typescript
if (authManager) {
  const settings = getSettings();
  // Only forward credentials when loginMode is 'auto'
  if (settings.auth.loginMode === 'auto') {
    const credEnv = await authManager.getCredentialsEnv();
    if (credEnv) Object.assign(env, credEnv);
  }

  const probe = authManager.browser;
  if (probe.channel) env.AIRTABLE_BROWSER_CHANNEL = probe.channel;
  if (probe.executablePath) env.AIRTABLE_BROWSER_PATH = probe.executablePath;

  // Always pass canonical profile dir
  env.AIRTABLE_PROFILE_DIR = path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');
}
```

Add `import * as os from 'os';` at the top if not already present.

- [ ] **Step 3: Build to verify**

Run: `pnpm -F airtable-formula build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/mcp/registration.ts
git commit -m "feat(registration): gate credential forwarding on loginMode setting"
```

---

### Task 9: DashboardProvider — Handle new messages and logout

**Files:**
- Modify: `packages/extension/src/webview/DashboardProvider.ts`

- [ ] **Step 1: Update logout handler to use new logout() method with confirmation**

Replace the `action:logout` handler (around line 129):

```typescript
if (msg.type === 'action:logout') {
  try {
    const confirm = await vscode.window.showWarningMessage(
      'This will clear your Airtable browser session and any stored credentials. You\'ll need to log in again.',
      { modal: true },
      'Logout',
    );
    if (confirm === 'Logout') {
      await this.authManager!.logout();
      await this.pushState();
    }
    this.postResult(msg.id, true);
  } catch (err) {
    this.postResult(msg.id, false, String(err));
  }
  return;
}
```

- [ ] **Step 2: Add manualLogin handler**

After the login handler, add:

```typescript
if (msg.type === 'action:manualLogin') {
  try {
    await this.authManager!.manualLogin();
    await this.pushState();
    this.postResult(msg.id, true);
  } catch (err) {
    this.postResult(msg.id, false, String(err));
  }
  return;
}
```

- [ ] **Step 3: Add openStoragePath handler**

```typescript
if (msg.type === 'action:openStoragePath') {
  try {
    await vscode.env.openExternal(vscode.Uri.file(msg.path));
    this.postResult(msg.id, true);
  } catch (err) {
    this.postResult(msg.id, false, String(err));
  }
  return;
}
```

- [ ] **Step 4: Update pushState() to include loginMode in settings and storage info**

In `pushState()`, update the settings construction to include `loginMode` and `browserChoice`:

```typescript
const settings = getSettings();

// In the settings object being constructed:
auth: {
  autoRefresh: settings.auth.autoRefresh,
  refreshIntervalHours: settings.auth.refreshIntervalHours,
  loginMode: settings.auth.loginMode,
  browserChoice: settings.auth.browserChoice,
},
```

- [ ] **Step 5: Build to verify**

Run: `pnpm -F airtable-formula build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/webview/DashboardProvider.ts
git commit -m "feat(dashboard): handle manual login, new logout flow, storage path open"
```

---

### Task 10: Webview Store — New actions

**Files:**
- Modify: `packages/webview/src/store.ts`

- [ ] **Step 1: Add new action signatures to the Store interface**

Add to the `Store` interface (after line 22):

```typescript
manualLogin: () => void;
backupSession: () => void;
restoreSession: () => void;
selectCustomBrowser: () => void;
setBrowserChoice: (choice: import('@shared/types.js').BrowserChoice) => void;
openStoragePath: (path: string) => void;
```

- [ ] **Step 2: Update defaultSettings to include new auth fields**

Update the `defaultSettings` constant, `auth` section:

```typescript
auth: {
  autoRefresh: true,
  refreshIntervalHours: 12,
  loginMode: 'manual' as const,
  browserChoice: undefined,
},
```

- [ ] **Step 3: Add action implementations**

Add inside the `create<Store>` callback, after the existing actions:

```typescript
manualLogin: () => {
  const id = randomId();
  set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
  sendToExtension({ type: 'action:manualLogin', id });
},

backupSession: () => {
  const id = randomId();
  set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
  sendToExtension({ type: 'action:backupSession', id });
},

restoreSession: () => {
  const id = randomId();
  set(s => ({ pendingActions: new Set([...s.pendingActions, id]) }));
  sendToExtension({ type: 'action:restoreSession', id });
},

selectCustomBrowser: () => {
  const id = randomId();
  sendToExtension({ type: 'action:selectCustomBrowser', id });
},

setBrowserChoice: (choice) => {
  const id = randomId();
  sendToExtension({ type: 'action:setBrowserChoice', id, choice });
},

openStoragePath: (p) => {
  const id = randomId();
  sendToExtension({ type: 'action:openStoragePath', id, path: p });
},
```

- [ ] **Step 4: Build webview to verify**

Run: `pnpm -F webview build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/store.ts
git commit -m "feat(webview): add store actions for manual login, backup, browser choice"
```

---

### Task 11: Settings.tsx — Login mode toggle and conditional rendering

**Files:**
- Modify: `packages/webview/src/tabs/Settings.tsx`

- [ ] **Step 1: Add Toggle icon import and extract loginMode from store**

At the top, add `ToggleLeft, ToggleRight, Monitor` to the lucide-react imports. In the `Settings` component, extract loginMode:

```typescript
const loginMode = settings.auth.loginMode ?? 'manual';
const isManual = loginMode === 'manual';
```

Also extract new store actions:

```typescript
const { saveCredentials, login, logout, status, installBrowser, removeBrowser, manualLogin, openStoragePath, backupSession, restoreSession } = useStore();
```

- [ ] **Step 2: Add login mode toggle at top of Airtable Account panel**

After the section header (line 90) and before the stack of list-rows, add:

```tsx
<div className="toggle-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 4 }}>
  <div style={{ flex: 1, minWidth: 0 }}>
    <div style={{ fontSize: '0.78rem', fontWeight: 500 }}>Login mode</div>
    <div style={{ fontSize: '0.65rem', color: 'var(--fg-muted)', marginTop: 1 }}>
      {isManual ? 'You log in through the browser — no credentials stored' : 'Automated login with stored credentials'}
    </div>
  </div>
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem' }}>
    <span style={{ color: isManual ? 'var(--fg)' : 'var(--fg-muted)', fontWeight: isManual ? 600 : 400 }}>Manual</span>
    <label className="toggle-switch">
      <input type="checkbox" checked={!isManual} onChange={() => sendToExtension({ type: 'setting:change', key: 'auth.loginMode', value: isManual ? 'auto' : 'manual' })} />
      <span className="toggle-track" />
    </label>
    <span style={{ color: !isManual ? 'var(--fg)' : 'var(--fg-muted)', fontWeight: !isManual ? 600 : 400 }}>Auto</span>
  </div>
</div>
```

- [ ] **Step 3: Conditionally hide credentials row and form in manual mode**

Wrap the "Credentials stored in OS keychain" `list-row` (lines 92-98) and the credentials card/form (lines 187-247) in `{!isManual && (...)}`:

```tsx
{!isManual && (
  <div className="list-row">
    <Shield size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
    <span style={{ fontSize: '0.72rem', flex: 1 }}>Credentials stored in OS keychain</span>
    <span className={auth.hasCredentials ? 'chip chip-ok' : 'chip chip-warn'}>
      {auth.hasCredentials ? 'Saved' : 'Not set'}
    </span>
  </div>
)}
```

Similarly wrap the `showCreds` card and form in `{!isManual && (...)}`.

- [ ] **Step 4: Update Session panel Login button for manual mode**

In the Session panel (line 282), update the Login action card:

```tsx
<div className="action-card" onClick={isBusy ? undefined : (isManual ? manualLogin : login)} style={{ flex: 1, minWidth: 100, cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.5 : 1 }}>
  <div className="icon-badge icon-badge-green" style={{ width: 22, height: 22 }}>
    <LogIn size={11} />
  </div>
  <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>{isManual ? 'Login in Browser' : 'Login'}</span>
</div>
```

- [ ] **Step 5: Update Auto-Refresh panel labels for manual mode**

In the Auto-Refresh panel (line 311):

```tsx
<SettingToggle
  label={isManual ? 'Monitor session health' : 'Auto-refresh session'}
  desc={isManual ? 'Periodically check session status and notify when expired' : 'Periodically check and re-login when session expires'}
  value={settings.auth.autoRefresh}
  settingKey="auth.autoRefresh"
/>
```

- [ ] **Step 6: Build webview and verify**

Run: `pnpm -F webview build`
Expected: Clean build.

- [ ] **Step 7: Commit**

```bash
git add packages/webview/src/tabs/Settings.tsx
git commit -m "feat(webview): login mode toggle with conditional credential UI"
```

---

## Phase 2: Browser/Config Propagation

### Task 12: Secure Permissions Utility

**Files:**
- Create: `packages/extension/src/mcp/secure-permissions.ts`

- [ ] **Step 1: Create secure-permissions.ts**

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Lock down a directory so only the current OS user can access it.
 * Best-effort — failures are logged but don't throw.
 */
export async function secureDirectory(dirPath: string): Promise<void> {
  try {
    const stat = await fs.stat(dirPath).catch(() => null);
    if (!stat?.isDirectory()) return;

    if (process.platform === 'win32') {
      await secureWindows(dirPath);
    } else {
      await secureUnix(dirPath);
    }
    console.log(`[secure-permissions] Secured: ${dirPath}`);
  } catch (err) {
    console.warn(`[secure-permissions] Failed to secure ${dirPath}:`, err);
  }
}

async function secureUnix(dirPath: string): Promise<void> {
  // Set root dir to 700
  await fs.chmod(dirPath, 0o700);

  // Walk and set children
  const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    const fullPath = path.join(entry.parentPath ?? entry.path, entry.name);
    try {
      if (entry.isDirectory()) {
        await fs.chmod(fullPath, 0o700);
      } else {
        await fs.chmod(fullPath, 0o600);
      }
    } catch {
      // Skip entries we can't chmod (e.g., symlinks)
    }
  }
}

async function secureWindows(dirPath: string): Promise<void> {
  const username = process.env.USERNAME;
  if (!username) {
    console.warn('[secure-permissions] USERNAME env var not set, skipping Windows ACL');
    return;
  }

  await execFileAsync('icacls', [
    dirPath,
    '/inheritance:r',
    '/grant:r',
    `${username}:(OI)(CI)F`,
  ]);
}
```

- [ ] **Step 2: Build to verify**

Run: `pnpm -F airtable-formula build`
Expected: Clean build. The AuthManager dynamic import of `./secure-permissions.js` now resolves.

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/mcp/secure-permissions.ts
git commit -m "feat(extension): add OS-level file permission hardening utility"
```

---

### Task 13: Browser Detection — detectAllBrowsers

**Files:**
- Modify: `packages/extension/src/mcp/browser-detect.ts`

- [ ] **Step 1: Add executablePath to BrowserProbe**

The `BrowserProbe` interface (line 14) already has `executablePath`. Verify it's exported. If not, export it.

- [ ] **Step 2: Create detectAllBrowsers function**

Add a new exported function that collects all matching browsers instead of returning the first:

```typescript
export function detectAllBrowsers(downloadedPath?: string): BrowserProbe[] {
  const results: BrowserProbe[] = [];

  const chrome = probeChrome();
  if (chrome) results.push(chrome);

  const edge = probeEdge();
  if (edge) results.push(edge);

  const chromium = probeChromium();
  if (chromium) results.push(chromium);

  if (downloadedPath) {
    results.push({
      found: true,
      channel: 'chromium',
      executablePath: downloadedPath,
      label: 'Bundled Chromium',
      downloaded: true,
    });
  }

  return results;
}
```

- [ ] **Step 3: Update detectBrowser to use detectAllBrowsers**

Refactor the existing `detectBrowser()` function to delegate:

```typescript
export function detectBrowser(downloadedPath?: string): BrowserProbe {
  const all = detectAllBrowsers(downloadedPath);
  return all[0] ?? { found: false };
}
```

- [ ] **Step 4: Build to verify nothing is broken**

Run: `pnpm -F airtable-formula build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/mcp/browser-detect.ts
git commit -m "feat(browser-detect): add detectAllBrowsers for multi-browser discovery"
```

---

### Task 14: AuthManager — Browser choice and available browsers

**Files:**
- Modify: `packages/extension/src/mcp/auth-manager.ts`

- [ ] **Step 1: Import detectAllBrowsers**

Update the import from `browser-detect.js`:

```typescript
import { detectBrowser, detectAllBrowsers, type BrowserProbe } from './browser-detect.js';
```

- [ ] **Step 2: Update refreshBrowserDetection to populate availableBrowsers**

In `refreshBrowserDetection()`, compute all browsers and include them in state:

```typescript
refreshBrowserDetection(): BrowserProbe {
  const downloadedPath = this._downloadManager?.getExecutablePath();
  const allBrowsers = detectAllBrowsers(downloadedPath);

  // Use user's browser choice if set, otherwise first available
  const settings = getSettings();
  const choice = settings.auth.browserChoice;
  let selected: BrowserProbe;

  if (choice?.mode === 'custom' && choice.executablePath) {
    selected = {
      found: true,
      channel: (choice.channel as BrowserProbe['channel']) ?? 'chromium',
      executablePath: choice.executablePath,
      label: choice.label ?? 'Custom browser',
    };
  } else if (choice?.mode === 'auto' && choice.executablePath) {
    // User picked a specific detected browser
    const match = allBrowsers.find(b => b.executablePath === choice.executablePath);
    selected = match ?? allBrowsers[0] ?? { found: false };
  } else {
    selected = allBrowsers[0] ?? { found: false };
  }

  this._browser = selected;
  this._updateState({
    browser: {
      found: selected.found,
      channel: selected.channel,
      label: selected.label,
      downloaded: selected.downloaded,
      executablePath: selected.executablePath,
    },
    availableBrowsers: allBrowsers.map(b => ({
      found: b.found,
      channel: b.channel,
      label: b.label,
      downloaded: b.downloaded,
      executablePath: b.executablePath,
    })),
  });
  return selected;
}
```

- [ ] **Step 3: Update _browserEnv to respect browser choice**

```typescript
private _browserEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (this._browser.channel) env.AIRTABLE_BROWSER_CHANNEL = this._browser.channel;
  if (this._browser.executablePath) env.AIRTABLE_BROWSER_PATH = this._browser.executablePath;
  return env;
}
```

This already works since `refreshBrowserDetection()` now sets `this._browser` from the user's choice. No changes needed if the current implementation already reads `this._browser`.

- [ ] **Step 4: Build to verify**

Run: `pnpm -F airtable-formula build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/mcp/auth-manager.ts
git commit -m "feat(auth): browser choice support and available browsers in state"
```

---

### Task 15: Auto-Config — Propagate browser choice to IDE configs

**Files:**
- Modify: `packages/extension/src/auto-config/index.ts`

- [ ] **Step 1: Import os and getSettings**

At the top of `index.ts`:

```typescript
import * as os from 'os';
import { getSettings } from '../settings.js';
```

- [ ] **Step 2: Update buildServerEntry to include browser + profile env vars**

Update `buildServerEntry()` (line 55):

```typescript
export function buildServerEntry(_serverPath: string): Record<string, unknown> {
  const env: Record<string, string> = {
    AIRTABLE_HEADLESS_ONLY: '1',
    AIRTABLE_PROFILE_DIR: path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile'),
  };

  const settings = getSettings();
  const choice = settings.auth.browserChoice;
  if (choice?.channel) env.AIRTABLE_BROWSER_CHANNEL = choice.channel;
  if (choice?.executablePath) env.AIRTABLE_BROWSER_PATH = choice.executablePath;

  return {
    command: 'node',
    args: [LAUNCHER_SCRIPT],
    env,
  };
}
```

- [ ] **Step 3: Update buildNpxServerEntry similarly**

```typescript
export function buildNpxServerEntry(): Record<string, unknown> {
  const env: Record<string, string> = {
    AIRTABLE_HEADLESS_ONLY: '1',
    AIRTABLE_PROFILE_DIR: path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile'),
  };

  const settings = getSettings();
  const choice = settings.auth.browserChoice;
  if (choice?.channel) env.AIRTABLE_BROWSER_CHANNEL = choice.channel;
  if (choice?.executablePath) env.AIRTABLE_BROWSER_PATH = choice.executablePath;

  return {
    command: 'npx',
    args: ['-y', 'airtable-user-mcp'],
    env,
  };
}
```

- [ ] **Step 4: Update auto-config test**

In `packages/extension/src/test/auto-config.test.ts`, update the `buildNpxServerEntry` test:

```typescript
describe('buildNpxServerEntry', () => {
  it('returns npx command structure', () => {
    const entry = buildNpxServerEntry();
    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual(['-y', 'airtable-user-mcp']);
    expect((entry.env as any).AIRTABLE_HEADLESS_ONLY).toBe('1');
    expect((entry.env as any).AIRTABLE_PROFILE_DIR).toContain('.airtable-user-mcp');
  });

  it('does not include NODE_PATH', () => {
    const entry = buildNpxServerEntry();
    expect((entry.env as any).NODE_PATH).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm -F airtable-formula test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/auto-config/index.ts packages/extension/src/test/auto-config.test.ts
git commit -m "feat(auto-config): propagate browser choice and profile dir to IDE configs"
```

---

### Task 16: DashboardProvider — Browser choice handlers

**Files:**
- Modify: `packages/extension/src/webview/DashboardProvider.ts`

- [ ] **Step 1: Add selectCustomBrowser handler**

```typescript
if (msg.type === 'action:selectCustomBrowser') {
  try {
    const filters: Record<string, string[]> = process.platform === 'win32'
      ? { 'Executables': ['exe'] }
      : process.platform === 'darwin'
        ? { 'Applications': ['app'] }
        : {};

    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters,
      title: 'Select a Chromium-based browser',
    });

    if (result?.[0]) {
      let execPath = result[0].fsPath;
      // macOS: resolve .app bundle to the actual binary
      if (process.platform === 'darwin' && execPath.endsWith('.app')) {
        const plist = path.join(execPath, 'Contents', 'Info.plist');
        // Use the basename of the .app as a reasonable guess for the executable name
        const appName = path.basename(execPath, '.app');
        execPath = path.join(execPath, 'Contents', 'MacOS', appName);
      }

      // Basic validation: check if filename suggests Chromium-based
      const base = path.basename(execPath).toLowerCase();
      const isChromium = ['chrome', 'chromium', 'edge', 'msedge', 'brave'].some(n => base.includes(n));
      if (!isChromium) {
        vscode.window.showWarningMessage('Only Chromium-based browsers are supported (Chrome, Edge, Chromium, Brave).');
      }

      const choice = { mode: 'custom' as const, executablePath: execPath, label: path.basename(execPath) };
      const cfg = vscode.workspace.getConfiguration('airtableFormula');
      await cfg.update('auth.browserChoice', choice, vscode.ConfigurationTarget.Global);
      this.authManager?.refreshBrowserDetection();
      await this.pushState();
    }
    this.postResult(msg.id, true);
  } catch (err) {
    this.postResult(msg.id, false, String(err));
  }
  return;
}
```

- [ ] **Step 2: Add setBrowserChoice handler**

```typescript
if (msg.type === 'action:setBrowserChoice') {
  try {
    const cfg = vscode.workspace.getConfiguration('airtableFormula');
    await cfg.update('auth.browserChoice', msg.choice, vscode.ConfigurationTarget.Global);
    this.authManager?.refreshBrowserDetection();

    // Re-write IDE MCP configs with updated browser/profile env vars
    const serverPath = getBundledServerPath(this.context);
    const serverEntry = getServerEntry(this.context);
    const { configureMcpForIde } = await import('../auto-config/index.js');
    const ideStatuses = await detectAllIdes();
    for (const ide of ideStatuses) {
      if (ide.detected && ide.mcpConfigured) {
        await configureMcpForIde(ide.ideId, serverPath, serverEntry);
      }
    }

    await this.pushState();
    this.postResult(msg.id, true);
  } catch (err) {
    this.postResult(msg.id, false, String(err));
  }
  return;
}
```

- [ ] **Step 3: Build to verify**

Run: `pnpm -F airtable-formula build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/webview/DashboardProvider.ts
git commit -m "feat(dashboard): add browser choice and custom browser selection handlers"
```

---

### Task 17: Settings.tsx — Browser selection dropdown

**Files:**
- Modify: `packages/webview/src/tabs/Settings.tsx`

- [ ] **Step 1: Extract browser selection state from store**

In the Settings component, add:

```typescript
const availableBrowsers = auth.availableBrowsers ?? [];
const browserChoice = settings.auth.browserChoice;
const { selectCustomBrowser, setBrowserChoice } = useStore();
```

- [ ] **Step 2: Replace static browser detection row with dropdown**

Replace the browser detection list-row (lines 100-111) with:

```tsx
<div className="list-row" style={{ flexWrap: 'wrap', gap: 6 }}>
  <Globe size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
  <span style={{ fontSize: '0.72rem', flex: 1 }}>
    Browser for authentication
    <span style={{ display: 'block', fontSize: '0.62rem', color: 'var(--fg-subtle)', marginTop: 1 }}>
      {availableBrowsers.length > 0
        ? `Detected: ${availableBrowsers.map(b => b.label).filter(Boolean).join(', ')}`
        : 'No browsers detected'}
    </span>
  </span>
  <select
    className="select-input"
    value={browserChoice?.executablePath ?? 'auto'}
    onChange={e => {
      const val = e.target.value;
      if (val === 'custom') {
        selectCustomBrowser();
      } else if (val === 'auto') {
        setBrowserChoice({ mode: 'auto' });
      } else {
        const browser = availableBrowsers.find(b => b.executablePath === val);
        if (browser) {
          setBrowserChoice({
            mode: 'auto',
            channel: browser.channel,
            executablePath: browser.executablePath,
            label: browser.label,
          });
        }
      }
    }}
  >
    {availableBrowsers.map(b => (
      <option key={b.executablePath} value={b.executablePath}>
        {b.label}{b.downloaded ? ' (bundled)' : ''}
      </option>
    ))}
    <option disabled>──────</option>
    <option value="custom">Custom path...</option>
  </select>
</div>
```

- [ ] **Step 3: Build webview**

Run: `pnpm -F webview build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/webview/src/tabs/Settings.tsx
git commit -m "feat(webview): browser selection dropdown with custom path option"
```

---

## Phase 3: Storage/Security UX

### Task 18: Storage Info Computation

**Files:**
- Modify: `packages/extension/src/webview/DashboardProvider.ts`

- [ ] **Step 1: Add storage computation helper**

Add a private method to `DashboardProvider`:

```typescript
private _storageCache?: { info: import('@airtable-formula/shared').StorageInfo; ts: number };

private async _computeStorageInfo(): Promise<import('@airtable-formula/shared').StorageInfo> {
  const now = Date.now();
  if (this._storageCache && now - this._storageCache.ts < 60_000) {
    return this._storageCache.info;
  }

  const os = await import('os');
  const fs = await import('fs/promises');
  const path = await import('path');

  const configDir = path.join(os.homedir(), '.airtable-user-mcp');
  const profileDir = path.join(configDir, '.chrome-profile');
  const toolConfig = path.join(configDir, 'tools-config.json');

  const entries: import('@airtable-formula/shared').StorageEntry[] = [];

  // Browser Profile
  entries.push(await this._storageEntry('Browser Profile', profileDir, fs));

  // Tool Config
  entries.push(await this._storageEntry('Tool Config', toolConfig, fs));

  // Bundled Chromium (if applicable)
  if (this.authManager) {
    const dlMgr = (this.authManager as any)._downloadManager;
    if (dlMgr) {
      const storageDir: string = dlMgr.getStorageDir();
      entries.push(await this._storageEntry('Bundled Chromium', storageDir, fs));
    }
  }

  const info = { entries };
  this._storageCache = { info, ts: now };
  return info;
}

private async _storageEntry(label: string, itemPath: string, fs: typeof import('fs/promises')): Promise<import('@airtable-formula/shared').StorageEntry> {
  try {
    const stat = await fs.stat(itemPath);
    let sizeBytes: number;
    if (stat.isDirectory()) {
      sizeBytes = await this._dirSize(itemPath, fs);
    } else {
      sizeBytes = stat.size;
    }
    return { label, path: itemPath, sizeBytes, exists: true };
  } catch {
    return { label, path: itemPath, exists: false };
  }
}

private async _dirSize(dirPath: string, fs: typeof import('fs/promises')): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        try {
          const p = (await import('path')).join(entry.parentPath ?? entry.path, entry.name);
          const s = await fs.stat(p);
          total += s.size;
        } catch {
          // skip
        }
      }
    }
  } catch {
    // empty or inaccessible
  }
  return total;
}
```

- [ ] **Step 2: Include storage in pushState()**

In `pushState()`, before constructing the state payload, compute storage:

```typescript
const storage = await this._computeStorageInfo();
```

Then include `storage` in the `DashboardState` object.

- [ ] **Step 3: Build to verify**

Run: `pnpm -F airtable-formula build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/webview/DashboardProvider.ts
git commit -m "feat(dashboard): compute and include storage info in dashboard state"
```

---

### Task 19: Settings.tsx — Storage & Data Panel

**Files:**
- Modify: `packages/webview/src/tabs/Settings.tsx`

- [ ] **Step 1: Add imports and state**

Add `FolderOpen, ChevronDown, ChevronRight, Archive, Upload` to lucide-react imports. Add state:

```typescript
const [storageOpen, setStorageOpen] = useState(false);
const storage = useStore(s => s.storage);
```

- [ ] **Step 2: Add helper to format bytes**

```typescript
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
```

Add this above the `Settings` component.

- [ ] **Step 3: Add Storage & Data panel after Session panel**

After the Session panel `</div>` (around line 302) and before the Auto-Refresh panel:

```tsx
{/* Storage & Data */}
<div className="glass-panel">
  <div
    className="section-header"
    onClick={() => setStorageOpen(!storageOpen)}
    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
  >
    <div>
      <div className="eyebrow">Diagnostics</div>
      <div className="title">Storage & Data</div>
    </div>
    {storageOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
  </div>
  {storageOpen && (
    <div className="stack stack-sm">
      {storage?.entries?.map((entry, i) => (
        <div key={i} className="list-row" style={{ flexWrap: 'wrap' }}>
          <FolderOpen size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 500 }}>{entry.label}</span>
              {entry.exists
                ? <span style={{ fontSize: '0.62rem', color: 'var(--fg-muted)' }}>{entry.sizeBytes != null ? formatBytes(entry.sizeBytes) : '...'}</span>
                : <span className="chip chip-warn" style={{ fontSize: '0.58rem' }}>Missing</span>
              }
            </div>
            <div style={{ fontSize: '0.58rem', fontFamily: 'var(--font-mono)', color: entry.exists ? 'var(--fg-subtle)' : 'var(--fg-muted)', marginTop: 1, wordBreak: 'break-all' }}>
              {entry.path}
            </div>
          </div>
          {entry.exists && (
            <button
              className="btn btn-ghost"
              onClick={() => openStoragePath(entry.path)}
              style={{ fontSize: '0.62rem', padding: '2px 8px', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }}
              title="Open in file explorer"
            >
              Open ↗
            </button>
          )}
        </div>
      ))}

      {/* OS Keychain row — only in auto mode */}
      {!isManual && (
        <div className="list-row">
          <Key size={14} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.72rem', flex: 1 }}>OS Keychain</span>
          <span className={auth.hasCredentials ? 'chip chip-ok' : 'chip chip-warn'} style={{ fontSize: '0.58rem' }}>
            {auth.hasCredentials ? 'Credentials: Saved' : 'Credentials: Not set'}
          </span>
        </div>
      )}

      {/* Backup & Restore */}
      <div style={{ display: 'flex', gap: 6, paddingTop: 4, borderTop: '1px solid var(--border)', marginTop: 4 }}>
        <button
          className="btn btn-ghost"
          onClick={backupSession}
          disabled={!storage?.entries?.some(e => e.exists)}
          style={{ flex: 1, fontSize: '0.68rem', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
        >
          <Archive size={11} /> Backup Session
        </button>
        <button
          className="btn btn-ghost"
          onClick={restoreSession}
          style={{ flex: 1, fontSize: '0.68rem', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
        >
          <Upload size={11} /> Restore Session
        </button>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 4: Build webview**

Run: `pnpm -F webview build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/tabs/Settings.tsx
git commit -m "feat(webview): add Storage & Data panel with paths, sizes, backup/restore"
```

---

### Task 20: Backup & Restore — Extension implementation

**Files:**
- Create: `packages/extension/src/mcp/session-backup.ts`
- Modify: `packages/extension/src/webview/DashboardProvider.ts`
- Modify: `packages/extension/package.json` (add devDeps)

- [ ] **Step 1: Install archiver and adm-zip**

Run:

```bash
cd packages/extension && pnpm add -D archiver @types/archiver adm-zip @types/adm-zip
```

- [ ] **Step 2: Create session-backup.ts**

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { createWriteStream, createReadStream } from 'fs';

const MAGIC = Buffer.from('ATSB'); // Airtable Session Backup
const CONFIG_DIR = path.join(os.homedir(), '.airtable-user-mcp');

export async function backupSession(destPath: string, password?: string): Promise<void> {
  // First create the zip in a temp buffer
  const zipBuffer = await createZipBuffer(CONFIG_DIR);

  if (password) {
    const encrypted = encrypt(zipBuffer, password);
    await fs.writeFile(destPath, encrypted);
  } else {
    await fs.writeFile(destPath, zipBuffer);
  }
}

export async function restoreSession(srcPath: string, password?: string): Promise<void> {
  const fileData = await fs.readFile(srcPath);

  let zipBuffer: Buffer;
  if (isEncrypted(fileData)) {
    if (!password) throw new Error('Backup is encrypted — password required');
    zipBuffer = decrypt(fileData, password);
  } else {
    zipBuffer = fileData;
  }

  // Validate it's a zip
  if (zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4B) {
    throw new Error('Invalid backup file — not a valid zip archive');
  }

  // Clear existing config dir (except .chrome-profile which we want to overwrite)
  await fs.rm(CONFIG_DIR, { recursive: true, force: true });
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  // Extract
  const zip = new AdmZip(zipBuffer);
  zip.extractAllTo(CONFIG_DIR, true);
}

export function isEncryptedFile(data: Buffer): boolean {
  return isEncrypted(data);
}

function isEncrypted(data: Buffer): boolean {
  return data.length >= 4 && data.subarray(0, 4).equals(MAGIC);
}

function encrypt(data: Buffer, password: string): Buffer {
  const salt = crypto.randomBytes(32);
  const key = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: [ATSB 4B][salt 32B][iv 12B][encrypted data][auth tag 16B]
  return Buffer.concat([MAGIC, salt, iv, encrypted, authTag]);
}

function decrypt(data: Buffer, password: string): Buffer {
  const salt = data.subarray(4, 36);
  const iv = data.subarray(36, 48);
  const authTag = data.subarray(data.length - 16);
  const encrypted = data.subarray(48, data.length - 16);

  const key = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw new Error('Incorrect password or corrupted backup');
  }
}

async function createZipBuffer(dirPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.directory(dirPath, false);
    archive.finalize();
  });
}
```

- [ ] **Step 3: Add backup/restore handlers to DashboardProvider**

In `DashboardProvider.ts`, add handlers:

```typescript
if (msg.type === 'action:backupSession') {
  try {
    const { backupSession } = await import('../mcp/session-backup.js');
    const date = new Date().toISOString().slice(0, 10);
    const dest = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`airtable-session-backup-${date}.zip`),
      filters: { 'Zip Archives': ['zip'] },
    });
    if (!dest) { this.postResult(msg.id, true); return; }

    const password = await vscode.window.showInputBox({
      prompt: 'Enter a password to encrypt the backup (leave empty for unencrypted)',
      password: true,
    });

    await backupSession(dest.fsPath, password || undefined);
    vscode.window.showInformationMessage(`Session backed up to ${dest.fsPath}`);
    this.postResult(msg.id, true);
  } catch (err) {
    vscode.window.showErrorMessage(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
    this.postResult(msg.id, false, String(err));
  }
  return;
}

if (msg.type === 'action:restoreSession') {
  try {
    const { restoreSession, isEncryptedFile } = await import('../mcp/session-backup.js');
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'Zip Archives': ['zip'] },
    });
    if (!files?.[0]) { this.postResult(msg.id, true); return; }

    const fileData = await (await import('fs/promises')).readFile(files[0].fsPath);
    let password: string | undefined;
    if (isEncryptedFile(fileData)) {
      password = await vscode.window.showInputBox({
        prompt: 'Enter the backup password',
        password: true,
      });
      if (password === undefined) { this.postResult(msg.id, true); return; }
    }

    const confirm = await vscode.window.showWarningMessage(
      'This will replace your current session data. Continue?',
      { modal: true },
      'Restore',
    );
    if (confirm !== 'Restore') { this.postResult(msg.id, true); return; }

    await restoreSession(files[0].fsPath, password);

    // Re-apply permissions and check session
    const { secureDirectory } = await import('../mcp/secure-permissions.js');
    const os = await import('os');
    const path = await import('path');
    await secureDirectory(path.join(os.homedir(), '.airtable-user-mcp'));
    await this.authManager?.checkSession();

    vscode.window.showInformationMessage('Session restored successfully');
    await this.pushState();
    this.postResult(msg.id, true);
  } catch (err) {
    vscode.window.showErrorMessage(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    this.postResult(msg.id, false, String(err));
  }
  return;
}
```

- [ ] **Step 4: Build to verify**

Run: `pnpm -F airtable-formula build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/mcp/session-backup.ts packages/extension/src/webview/DashboardProvider.ts packages/extension/package.json pnpm-lock.yaml
git commit -m "feat(extension): add encrypted backup/restore for session data"
```

---

## Phase 4: Packaging & Tests

### Task 21: Extension Command Updates

**Files:**
- Modify: `packages/extension/src/extension.ts`

- [ ] **Step 1: Update the logout command**

Find the `airtable-formula.logout` command (around line 458). Update it to use the new `authManager.logout()` method with confirmation:

```typescript
vscode.commands.registerCommand('airtable-formula.logout', async () => {
  const confirm = await vscode.window.showWarningMessage(
    'This will clear your Airtable browser session and any stored credentials. You\'ll need to log in again.',
    { modal: true },
    'Logout',
  );
  if (confirm !== 'Logout') return;
  await authManager.logout();
  dashboardProvider.refresh();
  vscode.window.showInformationMessage('Airtable: Logged out and session cleared.');
}),
```

- [ ] **Step 2: Update the login command to respect loginMode**

Find the `airtable-formula.login` command (around line 435). Update to check loginMode:

```typescript
vscode.commands.registerCommand('airtable-formula.login', async () => {
  const settings = getSettings();
  if (settings.auth.loginMode === 'manual') {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Airtable: Opening browser for login...' },
      () => authManager.manualLogin(),
    );
  } else {
    if (!(await authManager.hasCredentials())) {
      vscode.window.showWarningMessage('Airtable Formula: No credentials stored. Open Settings tab in the dashboard to save your Airtable credentials.');
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Airtable: Logging in...' },
      () => authManager.login(),
    );
  }
}),
```

- [ ] **Step 3: Build to verify**

Run: `pnpm -F airtable-formula build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/extension.ts
git commit -m "feat(extension): update login/logout commands for manual/auto mode"
```

---

### Task 22: Webview Store Tests

**Files:**
- Modify: `packages/webview/src/test/store.test.ts`

- [ ] **Step 1: Update test defaults to include new auth fields**

In `beforeEach`, update the settings object:

```typescript
settings: {
  mcp: { autoConfigureOnInstall: true, notifyOnUpdates: true, toolProfile: { profile: 'safe-write', enabledCount: 23, totalCount: 32, categories: { read: true, fieldWrite: true, fieldDestructive: true, viewWrite: true, viewDestructive: true, extension: true } }, serverSource: 'bundled' },
  ai: { autoInstallFiles: true, includeAgents: false },
  formula: { formatterVersion: 'v2' },
  auth: { autoRefresh: true, refreshIntervalHours: 12, loginMode: 'manual' },
  debug: { enabled: false, verboseHttp: false, bufferSize: 1000 },
},
auth: { status: 'unknown', hasCredentials: false },
```

- [ ] **Step 2: Add manualLogin test**

```typescript
it('manualLogin sends action:manualLogin message', () => {
  useStore.getState().manualLogin();
  expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:manualLogin' }));
});
```

- [ ] **Step 3: Add backupSession test**

```typescript
it('backupSession sends action:backupSession message', () => {
  useStore.getState().backupSession();
  expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:backupSession' }));
});
```

- [ ] **Step 4: Add restoreSession test**

```typescript
it('restoreSession sends action:restoreSession message', () => {
  useStore.getState().restoreSession();
  expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:restoreSession' }));
});
```

- [ ] **Step 5: Add openStoragePath test**

```typescript
it('openStoragePath sends action:openStoragePath with path', () => {
  useStore.getState().openStoragePath('/tmp/test');
  expect(sendToExtension).toHaveBeenCalledWith(expect.objectContaining({ type: 'action:openStoragePath', path: '/tmp/test' }));
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/webview/src/test/store.test.ts
git commit -m "test(webview): add store tests for manual login, backup, restore, storage"
```

---

### Task 23: Full Build and Package Verification

**Files:** None — verification only

- [ ] **Step 1: Full clean build**

Run: `pnpm build`
Expected: All packages build successfully. `dist/mcp/manual-login-runner.mjs` exists alongside the other three `.mjs` files.

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Package VSIX**

Run: `pnpm packx:no-bump`
Expected: `.vsix` is created without errors. Verify that `archiver` and `adm-zip` are bundled into the extension output (they should be inlined by tsup since they're imported in extension code).

- [ ] **Step 4: Verify VSIX contents**

Run:

```bash
# List files in the VSIX to verify manual-login-runner.mjs is included
unzip -l packages/extension/*.vsix | grep -E "(manual-login|session-backup|secure-permissions)"
```

Expected: `dist/mcp/manual-login-runner.mjs`, `dist/mcp/session-backup.js`, `dist/mcp/secure-permissions.js` are present.

- [ ] **Step 5: Commit any packaging fixes if needed**

If the VSIX verification reveals issues (e.g., missing bundled deps), fix and commit.

---

### Task 24: Manual Smoke Test

**Files:** None — testing only

- [ ] **Step 1: Install the VSIX locally**

```bash
code --install-extension packages/extension/*.vsix
```

- [ ] **Step 2: Verify manual mode (default for fresh install)**

1. Open VS Code, open the Airtable Formula dashboard
2. Settings tab should show Login Mode toggle defaulting to "Manual"
3. Credential form should be hidden
4. "Login in Browser" button should appear in Session panel
5. Click "Login in Browser" — a visible Chrome window should open to airtable.com/login

- [ ] **Step 3: Verify auto mode**

1. Toggle to "Auto" mode
2. Credential form should appear
3. Enter credentials and save
4. Click "Login" — should run the automated login flow

- [ ] **Step 4: Verify Storage & Data panel**

1. Expand the "Storage & Data" section
2. Verify paths are displayed with correct sizes
3. Click "Open" buttons — should open file explorer to each path
4. Verify "Backup Session" and "Restore Session" buttons are present

- [ ] **Step 5: Verify browser selection dropdown**

1. Browser dropdown should list detected browsers
2. Selecting a different browser should update the setting
3. "Custom path..." should trigger a file picker

- [ ] **Step 6: Verify logout clears both credentials and profile**

1. Click Logout
2. Confirmation dialog should appear
3. After confirming, auth state should reset
4. Browser profile directory should be deleted
