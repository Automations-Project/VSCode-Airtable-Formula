# Auth Security Upgrade — Design Spec

**Date:** 2026-04-14
**Motivation:** Airtable team raised concerns about credential safety. This upgrade adds a zero-credential manual login mode, transparent storage visibility, encrypted backup/restore, file permission hardening, and user-selectable browser choice.

---

## 1. Login Mode Toggle

### New setting

`airtableFormula.auth.loginMode`: `'manual'` | `'auto'`

- Default for **new installs**: `'manual'`
- Default for **existing users with saved credentials**: `'auto'` (migration logic)

### Migration logic (one-time, at `AuthManager.init()`)

Use `workspace.getConfiguration('airtableFormula').inspect('auth.loginMode')` — not `.get()`. The `inspect()` method distinguishes between "user never set this" (all scopes undefined) and "user explicitly set it." Using `.get()` would return the default value from `package.json`, masking the "unset" state and preventing correct migration detection.

When all scopes are undefined (pre-update install):

- If `hasCredentials === true` → write `loginMode: 'auto'` to global scope
- If `hasCredentials === false` → write `loginMode: 'manual'` to global scope

Once written, the user controls it from the UI toggle.

### UI changes — "Airtable Account" panel

A segmented toggle at the top of the panel, after the section header:

```
[Login Mode]                    Manual ◯──● Auto
```

**Manual mode shows:**

- Info row: "You log in through the browser — no credentials are stored by this extension"
- Browser detection row (unchanged)
- Browser selection dropdown (new — see Section 4c)
- Bundled Chromium row (unchanged)

**Manual mode hides:**

- "Credentials stored in OS keychain" row
- Credential input form (Set/Update credentials card)

**Auto mode shows:**

- Everything as it exists today (unchanged)

### UI changes — Session panel

**Manual mode:**

- "Login" button → relabeled "Login in Browser"
- Behavior: spawns visible browser, user logs in manually
- "Check" button unchanged
- "Logout" button behavior changes. New `AuthManager.logout()` method handles both modes:
  - **Always** deletes `~/.airtable-user-mcp/.chrome-profile/` directory (the actual session) with confirmation dialog: "This will clear your Airtable browser session. You'll need to log in again. Continue?"
  - **Always** clears SecretStorage credentials (if any exist) — this ensures no orphaned keychain entries when switching from auto to manual
  - Resets auth state to `{ status: 'unknown', hasCredentials: false }`

### Credential lifecycle when switching modes

**Rule: switching to manual mode preserves keychain credentials but suppresses them everywhere.**

- `hasCredentials` continues to reflect the actual SecretStorage state (the dashboard reads it directly from SecretStorage via `DashboardProvider.pushState()` — this is authoritative, not faked)
- When `loginMode === 'manual'`, the credentials form is hidden in the UI, but credentials may still exist in the keychain from a previous auto session
- `registration.ts` (the native VS Code MCP server provider) must **gate credential forwarding on loginMode**: only call `authManager.getCredentialsEnv()` and inject creds into the MCP server env when `loginMode === 'auto'`. In manual mode, only browser channel/path env vars are forwarded.
- This means `registration.ts` is a modified file
- Switching from manual → auto resurfaces the existing credentials (if still present) and the form re-appears, no re-entry needed
- Only explicit "Logout" purges both the profile and the keychain

**Auto mode:**

- Unchanged from current behavior

### UI changes — Auto-Refresh panel

**Manual mode:**

- Auto-refresh toggle still visible, but relabeled: "Monitor session health"
- Description: "Periodically check session status and notify when expired"
- The timer runs health checks but **never** auto-re-logins — instead fires a VS Code notification on expiry

**Auto mode:**

- Unchanged (health check + auto-re-login on expiry)

---

## 2. Manual Login Flow

### New script: `packages/mcp-server/src/manual-login-runner.js`

Stripped-down variant of `login-runner.js`:

- Opens **visible** (headless: false) Chromium to `airtable.com/login`
- No credentials passed — user types everything
- Browser's native autofill works naturally via the persistent Chromium profile
- Polls `getUserProperties` with 5-minute timeout (vs 60s for auto)
- Same stdout JSON contract: `{ ok: true, userId }` or `{ ok: false, error }`
- On success, closes browser automatically

### Script vs AuthManager timeouts

`AuthManager._spawnScript()` currently kills all child processes after 120s. This is too short for manual login where the user is typing. The fix:

- `_spawnScript()` accepts an optional `timeoutMs` parameter (default: 120_000)
- `login()` passes `timeoutMs: 330_000` (5.5 minutes) when spawning `manual-login-runner.mjs` — slightly longer than the script's own 5-minute poll window to let the script exit cleanly
- Auto login keeps the current 120s timeout

### Environment variables (input)

| Var | Required | Notes |
|-----|----------|-------|
| `AIRTABLE_BROWSER_CHANNEL` | No | patchright channel |
| `AIRTABLE_BROWSER_PATH` | No | Custom browser executable |
| `AIRTABLE_PROFILE_DIR` | No | Absolute path to profile directory (default: `~/.airtable-user-mcp/.chrome-profile/`) |

No `AIRTABLE_EMAIL`, `AIRTABLE_PASSWORD`, or `AIRTABLE_OTP_SECRET`.

### Profile path canonicalization

Currently, `auth.js`, `login-runner.js`, and `health-check.js` all resolve `.chrome-profile` relative to their own script directory (`path.join(__dirname, '..', '.chrome-profile')`). When bundled into the extension, this lands inside `dist/mcp/` — an ephemeral build artifact. This is fragile and inconsistent with the spec's assumption of `~/.airtable-user-mcp/.chrome-profile/`.

**Fix:** All three scripts + `manual-login-runner.js` change to resolve the profile path as:

```javascript
const profileDir = process.env.AIRTABLE_PROFILE_DIR
  || path.join(os.homedir(), '.airtable-user-mcp', '.chrome-profile');
```

- New env var `AIRTABLE_PROFILE_DIR` replaces the old `AIRTABLE_PROFILE` (which was a relative dir name)
- `AuthManager` passes the absolute canonical path via this env var
- Standalone CLI (`npx airtable-user-mcp`) also defaults to `~/.airtable-user-mcp/.chrome-profile/`
- The old relative-to-`__dirname` resolution is removed
- `login.js` (interactive CLI login) gets the same path change — currently uses `path.join(__dirname, '..', '.chrome-profile')`
- `cli.js` logout command currently deletes `session.json` — update to delete the `.chrome-profile/` directory instead, matching the new canonical session location

This means `auth.js`, `login-runner.js`, `health-check.js`, and `manual-login-runner.js` are all modified files (added to the file list below).

### AuthManager changes

**`login()` method:**

```
if loginMode === 'auto':
  → spawn login-runner.mjs with credential env vars (current behavior)
if loginMode === 'manual':
  → spawn manual-login-runner.mjs with browser env vars only
```

**New method: `manualLogin()`**

Always spawns the manual flow regardless of `loginMode`. Used by the expiry notification's "Re-login" button.

### Session expiry notification (Manual mode)

In `_autoRefreshCycle()`, when session is expired and `loginMode === 'manual'`:

1. Fire `vscode.window.showWarningMessage('Airtable session expired.', 'Re-login in Browser')`
2. If user clicks "Re-login in Browser" → call `manualLogin()`
3. Dashboard status updates to "Expired" with "Re-login in Browser" button

---

## 3. Storage & Data Panel

### New glass-panel in Settings

Placed after Session panel, under eyebrow "Diagnostics", title "Storage & Data".

**Collapsible** — starts collapsed by default. Chevron toggle with `useState`.

### New types in `packages/shared/src/types.ts`

```typescript
export interface StorageEntry {
  label:      string;      // e.g. "Browser Profile"
  path:       string;      // resolved absolute path
  sizeBytes?: number;      // undefined if not yet computed or N/A
  exists:     boolean;
}

export interface StorageInfo {
  entries: StorageEntry[];
}
```

`DashboardState` gets: `storage?: StorageInfo`

`SettingsSnapshot.auth` extends to:

```typescript
auth: {
  autoRefresh: boolean;
  refreshIntervalHours: number;
  loginMode: 'manual' | 'auto';        // NEW
  browserChoice?: BrowserChoice;        // NEW
};
```

### Entries

| Label | Path | Notes |
|-------|------|-------|
| Browser Profile | `~/.airtable-user-mcp/.chrome-profile/` | Session cookies |
| Tool Config | `~/.airtable-user-mcp/tools-config.json` | Single file |
| Bundled Chromium | `<globalStorage>/browsers/chromium-*/` | Only if downloaded |
| OS Keychain | *(no path displayed)* | Only shown when `loginMode === 'auto'`. Shows "Credentials: Saved / Not set" chip |

### UI per row

```
[FolderIcon]  Browser Profile           42.3 MB
              ~/.airtable-user-mcp/.chrome-profile/
                                        [Open ↗]
```

- Label + size (right-aligned) on first line
- Path in monospace, subtle color, second line
- "Open" button → sends `action:openStoragePath` message → extension calls `vscode.env.openExternal(vscode.Uri.file(path))`
- If `exists: false` → path grayed out, "Missing" chip instead of size

### New message type

```typescript
// Webview → Extension
| { type: 'action:openStoragePath'; id: string; path: string }
```

### Size computation

Done in extension host during `DashboardProvider.pushState()`:

- Directories: recursive walk with `fs.stat` summing `size`
- Files: single `fs.stat`
- Cached for 60 seconds to avoid repeated I/O

### Backup & Restore

Two buttons at the bottom of the Storage & Data panel:

```
[Download↓] Backup Session    [Upload↑] Restore Session
```

**Backup flow:**

1. `vscode.window.showSaveDialog` → default filename: `airtable-session-backup-YYYY-MM-DD.zip`
2. `vscode.window.showInputBox({ password: true })` → "Enter a password to encrypt the backup (leave empty for unencrypted)"
3. If password → encrypt with AES-256-GCM:
   - Derive key via `crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')`
   - Random 32-byte salt, random 12-byte IV
   - Output format: `[ATSB magic 4B][salt 32B][iv 12B][encrypted zip][auth tag 16B]`
4. If empty → plain zip
5. Zips `~/.airtable-user-mcp/` directory (excluding temp/lock files)
6. Notification: "Session backed up to <path>"

**Restore flow:**

1. `vscode.window.showOpenDialog` → filter: `*.zip`
2. Detect encryption: check if file starts with magic bytes `ATSB` (4 bytes, "Airtable Session Backup"). Encrypted files use format `[ATSB magic 4B][salt 32B][iv 12B][encrypted zip][auth tag 16B]`. Plain zips start with `PK` (0x504B) — easy to distinguish.
3. If encrypted → `vscode.window.showInputBox({ password: true })` → "Enter the backup password"
4. Wrong password → auth tag mismatch → error: "Incorrect password or corrupted backup"
5. Confirmation dialog: "This will replace your current session data. Continue?"
6. Extract to `~/.airtable-user-mcp/`, overwriting existing
7. Re-apply file permissions (Section 4a)
8. Trigger session health check
9. Notification: "Session restored successfully"

**Edge cases:**

- Backup button disabled if `~/.airtable-user-mcp/` doesn't exist
- Restore validates zip structure before extracting
- Both show VS Code notification on completion

**Dependencies:** Node built-in only (`crypto`, `zlib`). Zip creation uses `archiver` (already available via npm — add as devDependency to extension package). Zip extraction uses `zlib` + `tar`-style stream parsing, or add `adm-zip` as a lightweight dev dependency. Both are build-time only — bundled by tsup into the extension output.

### New message types

```typescript
// Webview → Extension
| { type: 'action:backupSession';  id: string }
| { type: 'action:restoreSession'; id: string }
```

---

## 4. Security Hardening — File Permissions

### New utility: `packages/extension/src/mcp/secure-permissions.ts`

**When applied:**

1. After successful login (both manual and auto) — in `AuthManager`, after `{ ok: true }` result
2. On extension activation (`AuthManager.init()`) — if profile directory exists
3. After session restore (backup restore flow)

**What gets locked down:**

| Path | Unix | Windows |
|------|------|---------|
| `~/.airtable-user-mcp/` | `chmod 700` (dir) | `icacls` owner-only |
| `~/.airtable-user-mcp/.chrome-profile/` | `chmod 700` (dir) | inherits from parent |
| `~/.airtable-user-mcp/tools-config.json` | `chmod 600` (file) | inherits from parent |

**Unix implementation:**

- `fs.chmod(dir, 0o700)` for directories
- `fs.chmod(file, 0o600)` for files
- Recursive walk for the profile directory

**Windows implementation:**

- `icacls "<path>" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F"`
- Removes inherited permissions, grants full control only to current user
- Single command per top-level directory — `(OI)(CI)` flags cascade to children

**Error handling:**

- Wrapped in try/catch — if permissions fail (network drive, restricted env), log warning to console but don't block login flow
- No UI for this — silent and automatic

---

## 5. Browser Selection

### Detect all browsers

**`browser-detect.ts` changes:**

New function: `detectAllBrowsers(downloadedPath?: string): BrowserInfo[]`

Returns all found browsers, not just the first. Each entry includes:

```typescript
export interface BrowserInfo {
  found:           boolean;
  channel?:        'chrome' | 'msedge' | 'chromium';
  label?:          string;
  downloaded?:     boolean;
  executablePath?: string;  // NEW — absolute path to the binary
}
```

The existing `detectBrowser()` becomes a wrapper: returns the user's chosen browser, or `availableBrowsers[0]` if no choice set.

### New types

```typescript
export interface BrowserChoice {
  mode: 'auto' | 'custom';
  channel?: string;
  executablePath?: string;
  label?: string;
}
```

### New setting

`airtableFormula.auth.browserChoice`: `BrowserChoice`

- Default: `{ mode: 'auto' }` — first detected browser wins (current behavior)
- Persisted in VS Code settings (not SecretStorage — not sensitive)

### AuthState changes

```typescript
export interface AuthState {
  // ... existing fields ...
  availableBrowsers?: BrowserInfo[];  // NEW — all detected browsers
  browserChoice?: BrowserChoice;      // NEW — user's selection
}
```

### UI — Browser selection dropdown

Replaces the current static browser detection row in the "Airtable Account" panel:

```
[Globe] Browser for authentication
        Auto-detected: Google Chrome, Microsoft Edge
                                        [Select ▾]
```

**Dropdown options:**

1. All auto-detected browsers (with labels: "Google Chrome", "Microsoft Edge", etc.)
2. Bundled Chromium (if downloaded)
3. Divider
4. "Custom path..." option

**When user picks a detected browser:**

- Saves `{ mode: 'auto', channel, executablePath, label }` to setting
- `AuthManager._browserEnv()` uses this to set `AIRTABLE_BROWSER_CHANNEL` and `AIRTABLE_BROWSER_PATH`

**When user picks "Custom path...":**

1. Sends `action:selectCustomBrowser` message to extension
2. Extension triggers `vscode.window.showOpenDialog` with filters:
   - Windows: `{ 'Executables': ['exe'] }`
   - macOS: `{ 'Applications': ['app'] }` — then resolve `Contents/MacOS/` binary inside
   - Linux: no filter
3. Extension validates Chromium-based: check binary name contains `chrome`, `chromium`, `edge`, or `brave`, or run `<path> --version` and check output
4. If not Chromium-based → warning: "Only Chromium-based browsers are supported (Chrome, Edge, Chromium, Brave)"
5. If valid → saves `{ mode: 'custom', executablePath, label: basename }` to setting

### Propagation to external IDE configs

`auto-config/index.ts` currently only passes `AIRTABLE_HEADLESS_ONLY: '1'` in `buildServerEntry()`. When the user selects a specific browser, the env block must also include `AIRTABLE_BROWSER_CHANNEL` and `AIRTABLE_BROWSER_PATH` so that Cursor, Claude Code, Windsurf, etc. use the same browser.

**Changes to `buildServerEntry()` and `buildNpxServerEntry()`:**

- Accept an optional `browserChoice?: BrowserChoice` parameter
- If set, include `AIRTABLE_BROWSER_CHANNEL` and/or `AIRTABLE_BROWSER_PATH` in the env block
- Also include `AIRTABLE_PROFILE_DIR` pointing to the canonical `~/.airtable-user-mcp/.chrome-profile/`
- When browser choice changes, re-write all configured IDE configs (call `configureMcpForIde` for each detected+configured IDE — not `setupIde`, which also reinstalls AI files)

This means `auto-config/index.ts` is a modified file.

### New message types

```typescript
// Webview → Extension
| { type: 'action:selectCustomBrowser'; id: string }
| { type: 'action:setBrowserChoice';    id: string; choice: BrowserChoice }
```

---

## Summary of New/Changed Files

### New files

| File | Purpose |
|------|---------|
| `packages/mcp-server/src/manual-login-runner.js` | Visible-browser manual login script |
| `packages/extension/src/mcp/secure-permissions.ts` | OS-level file permission hardening |

### Modified files

| File | Changes |
|------|---------|
| `packages/shared/src/types.ts` | Add `StorageEntry`, `StorageInfo`, `BrowserChoice`; extend `AuthState`, `DashboardState`, `SettingsSnapshot` |
| `packages/shared/src/messages.ts` | Add new message types (openStoragePath, backupSession, restoreSession, selectCustomBrowser, setBrowserChoice) |
| `packages/extension/src/mcp/auth-manager.ts` | Login mode branching, manual login, expiry notification, permission calls, backup/restore, browser choice |
| `packages/extension/src/mcp/browser-detect.ts` | `detectAllBrowsers()`, return `executablePath` in `BrowserInfo` |
| `packages/extension/src/mcp/browser-download.ts` | Expose storage path for StorageInfo |
| `packages/extension/src/webview/DashboardProvider.ts` | Handle new messages, compute StorageInfo, pushState changes |
| `packages/extension/src/settings.ts` | New settings: `auth.loginMode`, `auth.browserChoice` |
| `packages/extension/package.json` | Register new `configuration` entries for `auth.loginMode` and `auth.browserChoice` |
| `packages/extension/src/auto-config/index.ts` | Propagate `browserChoice` + `AIRTABLE_PROFILE_DIR` into IDE env blocks |
| `packages/mcp-server/src/auth.js` | Profile path: resolve from `AIRTABLE_PROFILE_DIR` env var / `~/.airtable-user-mcp/.chrome-profile/` |
| `packages/mcp-server/src/login-runner.js` | Same profile path change |
| `packages/mcp-server/src/health-check.js` | Same profile path change |
| `packages/mcp-server/src/login.js` | Same profile path change (interactive CLI login) |
| `packages/mcp-server/src/cli.js` | Logout command: delete `.chrome-profile/` dir instead of `session.json` |
| `packages/extension/src/mcp/registration.ts` | Gate credential forwarding on `loginMode` — only inject creds when `auto` |
| `packages/webview/src/store.ts` | New actions: manualLogin, backupSession, restoreSession, selectCustomBrowser, setBrowserChoice |
| `packages/webview/src/tabs/Settings.tsx` | Login mode toggle, conditional rendering, Storage & Data panel, browser selector |
| `scripts/bundle-mcp.mjs` | Bundle `manual-login-runner.js` alongside existing scripts |

### Dependencies

- **Node built-ins** (no install needed): `crypto` (encryption), `zlib` (compression), `fs` (permissions), `child_process` (icacls on Windows)
- **New devDependencies** (extension package): `archiver` (zip creation), `adm-zip` (zip extraction) — bundled by tsup into the extension output, not shipped as runtime dependencies
