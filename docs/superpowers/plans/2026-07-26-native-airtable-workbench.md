# Native Airtable Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dense, dark-glass dashboard with the approved Native Airtable Workbench, harden both sides of the webview boundary, and reach a defensible 10/10 only after automated and real-VS-Code accessibility verification.

**Architecture:** Keep React, Zustand, Vite, and the four existing top-level tabs. Introduce a pure readiness selector, small semantic UI primitives, progressively disclosed tab sections, a shared runtime-validated message contract, host-side opaque-ID resolution, and a strict nonce-only CSP. Preserve every current dashboard capability while moving status and actions into a readiness-first information architecture.

**Tech Stack:** TypeScript, React 19, Zustand 5, Vite 6, Vitest, React Testing Library, user-event, jest-dom, axe-core, VS Code Webview API, VS Code extension host APIs, pnpm workspaces.

## Global Constraints

- The approved source of truth is [`docs/superpowers/specs/2026-07-26-native-airtable-workbench-design.md`](../specs/2026-07-26-native-airtable-workbench-design.md).
- The sync work landed separately in commit `0b444db`; it remains out of scope. Do not alter or revert:
  - `packages/mcp-server/src/sync/index.js`
  - `packages/mcp-server/test/sync/test-index.test.js`
- Before every commit, run `git status --short` and stage only the paths named by that task.
- Use test-driven development for behavior changes: add a test that describes a real user-visible or trust-boundary failure, observe the intended red failure, implement the smallest complete behavior, and rerun the focused test.
- Do not add a UI framework, router, animation package, icon package, font, schema-validation dependency, or component generator. The existing `lucide-react` dependency remains the icon source.
- Do not remove IDEs, MCP/LSP setup, remote tunnels, prompt management, authentication modes, browser selection, storage/backup, official Airtable MCP configuration, tool profiles, formula/script settings, or diagnostics.
- Do not persist credentials, tokens, paths, prompts, settings, or host state through `vscodeApi.setState`. Persist only the active top-level tab.
- Every webview-to-host and host-to-webview message must be runtime-validated before it reaches application state or side-effect handlers.
- Generated `.ds-src` and `.ds-css` files are never hand-edited. Update source and overlays, then run `.design-sync/prep-src.mjs`.
- Use VS Code semantic color/font variables with fallbacks. Airtable colors are accents, not page backgrounds.
- Add no new JSX/SVG inline styles. Owning slices remove inherited inline presentation, and Task 12 enforces zero rendered `style` attributes. The final UI has no ambient animation, `transition: all`, positive `tabIndex`, or direct external `<a href>` navigation.
- Automated success is not a 10/10 claim. The final rating remains provisional until the actual extension passes light, dark, high-contrast, narrow-width, keyboard-only, reduced-motion, and NVDA checks.
- Current automated baseline to improve:
  - Webview bundle: approximately 89.52 KiB gzip JavaScript and 4.80 KiB gzip CSS.
  - Test report: 88 tests, of which 44 are generated mirror duplicates rather than independent rendered coverage.
  - Production audit: 4 low, 21 moderate, 8 high advisories.

---

## Responsibility and File Map

| Area | Owns | Must not own |
|---|---|---|
| Shared contract | `packages/shared/src/types.ts`, `messages.ts`, new `webview-contract.ts`, shared tests | VS Code APIs or React |
| Extension boundary | `DashboardProvider.ts`, `html.ts`, `settings.ts`, browser detection/auth resolution, extension tests | Rendering or webview-local focus |
| Webview orchestration | `App.tsx`, `store.ts`, `lib/vscode.ts`, new `lib/confirmation.ts` | Filesystem paths, executable paths, arbitrary URLs |
| Semantic UI system | New components under `packages/webview/src/components`, layered CSS under `src/styles` | Business-state derivation |
| Readiness | New pure `selectors/readiness.ts` plus tests | Side effects |
| Overview | `tabs/Overview.tsx` and `tabs/overview/*` | Duplicate daemon/auth/editor controls |
| Setup | `tabs/Setup.tsx`, `tabs/setup/*`, `EditorCard.tsx` | Account settings or support/about |
| Prompts | `tabs/Prompts.tsx`, `tabs/prompts/*` | Browser-native confirmation dialogs |
| Settings | `tabs/Settings.tsx`, `tabs/settings/*` | Daemon lifecycle controls |
| CSP and inline-style eradication | All rendered components/assets plus `html.ts` | New inline exceptions |
| Design sync | `.design-sync/conventions.md`, overlays, previews, notes | Hand edits to generated mirrors |
| Dependency hardening | `packages/mcp-server/package.json`, `pnpm-lock.yaml` only | Feature changes or unrelated MCP sync files |

## Target Public Interfaces

Land these names consistently so slices can be developed independently:

```ts
export type DashboardTabId = 'overview' | 'setup' | 'prompts' | 'settings';
export type BrowserId =
  | 'chrome'
  | 'edge'
  | 'chromium'
  | 'brave'
  | 'bundled-chromium'
  | 'custom-browser';
export type DetectedBrowserId = Exclude<BrowserId, 'custom-browser'>;
export type StorageEntryId = 'browser-profile' | 'tool-config' | 'bundled-chromium';
export type WebviewLinkId = 'docs' | 'changelog' | 'github' | 'chrome';
export type ConfirmationKind = 'discard-prompt-edits';

export interface ActionOutcome {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; type?: string };
```

The host remains the only owner of raw URLs, filesystem paths, browser executable paths, secret storage, and confirmation UI.

---

### Task 1: Add a real rendered-test foundation

**Files:**

- Modify: `packages/webview/package.json`
- Create: `packages/webview/vitest.config.ts`
- Create: `packages/webview/src/test/test-setup.ts`
- Create: `packages/webview/src/test/dashboard-state.fixture.ts`
- Create: `packages/webview/src/test/app.render.test.tsx`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: current `App`, `DashboardState`, and webview alias `@shared`.
- Produces: a jsdom test environment, real component rendering helpers, deterministic browser API stubs, and generated-mirror exclusions.

- [ ] **Step 1: Write a rendered smoke test against the real app**

Create `packages/webview/src/test/app.render.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App.js';
import { useStore } from '../store.js';

describe('App rendered shell', () => {
  beforeEach(() => {
    useStore.setState({ loading: true, activeTab: 'overview' });
  });

  it('renders the real loading state in a DOM', () => {
    render(<App />);

    expect(screen.getByText('Loading dashboard…')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused test and observe the intended red failure**

Run:

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/app.render.test.tsx
```

Expected red result: Vitest cannot resolve `@testing-library/react` and/or does not have a DOM environment. Do not change `App` to satisfy this infrastructure failure.

- [ ] **Step 3: Install the exact test-only dependencies**

Run:

```powershell
pnpm --filter @airtable-formula/webview add -D @testing-library/react@16.3.2 @testing-library/user-event@14.6.1 @testing-library/jest-dom@7.0.0 jsdom@29.1.1 axe-core@4.12.1
```

Keep all five packages in `devDependencies`; none may enter the production webview bundle.

- [ ] **Step 4: Add the Vitest configuration**

Create `packages/webview/vitest.config.ts`:

```ts
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/test-setup.ts'],
    include: ['src/test/**/*.test.ts', 'src/test/**/*.test.tsx'],
    exclude: ['**/.ds-src/**', '**/.ds-css/**', '**/dist/**', '**/node_modules/**'],
    css: true,
    restoreMocks: true,
    clearMocks: true,
  },
});
```

Change the webview test script to:

```json
"test": "vitest run --config vitest.config.ts"
```

Create `packages/webview/src/test/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

export const vscodeApiMock = {
  postMessage: vi.fn(),
  getState: vi.fn<() => unknown>().mockReturnValue(undefined),
  setState: vi.fn(),
};

Object.defineProperty(globalThis, 'acquireVsCodeApi', {
  configurable: true,
  value: vi.fn(() => vscodeApiMock),
});

afterEach(() => {
  cleanup();
  document.body.className = '';
  vscodeApiMock.getState.mockReturnValue(undefined);
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverStub,
});

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
});
```

Create a fully typed `makeDashboardState()` fixture in `dashboard-state.fixture.ts`. Its default must represent a valid session, healthy daemon on port 8723, one ready Cursor client, no active tunnel, the current 71-tool safe-write profile, current extension/MCP versions, and an empty prompt list. Accept `Partial<DashboardState>` at the top level and explicit nested overrides for `settings`, `auth`, `daemon`, `tunnel`, and `ideStatuses`.

- [ ] **Step 5: Run the test foundation and confirm green**

Run:

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/app.render.test.tsx
pnpm --filter @airtable-formula/webview test
```

Expected green result: the rendered test passes in jsdom; the legacy helper/store tests still pass once each; no `.ds-src` or `.ds-css` mirror tests are discovered.

- [ ] **Step 6: Commit only the test foundation**

```powershell
git status --short
git add packages/webview/package.json packages/webview/vitest.config.ts packages/webview/src/test/test-setup.ts packages/webview/src/test/dashboard-state.fixture.ts packages/webview/src/test/app.render.test.tsx pnpm-lock.yaml
git commit -m "test(webview): add rendered interaction foundation"
```

---

### Task 2: Replace compile-time trust with a strict shared runtime contract

**Files:**

- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/messages.ts`
- Create: `packages/shared/src/webview-contract.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/test/webview-contract.test.ts`

**Interfaces:**

- Consumes: every current `ExtensionMessage`, `WebviewMessage`, `DashboardState`, prompt definition, setting value, IDE ID, tunnel provider, browser summary, and storage entry.
- Produces: closed discriminated unions, safe DTOs, `parseWebviewMessage(unknown)`, `parseExtensionMessage(unknown)`, stable IDs, and reusable prompt validation.

- [ ] **Step 1: Write hostile-boundary tests first**

Create `packages/shared/src/test/webview-contract.test.ts` with literal assertions:

```ts
import { describe, expect, it } from 'vitest';
import { parseWebviewMessage } from '../webview-contract.js';

describe('parseWebviewMessage', () => {
  it('accepts a declared external link id', () => {
    expect(parseWebviewMessage({
      type: 'action:openLink',
      id: 'abc123',
      link: 'docs',
    })).toEqual({
      ok: true,
      value: { type: 'action:openLink', id: 'abc123', link: 'docs' },
    });
  });

  it.each([
    {
      name: 'raw URL',
      value: {
        type: 'action:openLink',
        id: 'abc123',
        link: 'docs',
        url: 'https://evil.test',
      },
    },
    {
      name: 'host-only setting',
      value: {
        type: 'setting:change',
        id: 'abc123',
        change: { key: 'mcp.serverPathOverride', value: 'C:\\evil\\server.mjs' },
      },
    },
    {
      name: 'custom executable',
      value: {
        type: 'action:setBrowserChoice',
        id: 'abc123',
        choice: { mode: 'custom', executablePath: 'C:\\evil.exe' },
      },
    },
    {
      name: 'raw storage path',
      value: {
        type: 'action:openStoragePath',
        id: 'abc123',
        path: 'C:\\Windows\\System32',
      },
    },
  ])('rejects $name payloads', ({ value }) => {
    expect(parseWebviewMessage(value).ok).toBe(false);
  });

  it('rejects duplicate prompt argument names', () => {
    const result = parseWebviewMessage({
      type: 'action:save-prompt',
      id: 'abc123',
      prompt: {
        name: 'inspect-base',
        description: 'Inspect a base',
        arguments: [
          { name: 'appId', description: 'Base', required: true },
          { name: 'appId', description: 'Duplicate', required: false },
        ],
        template: '{appId}',
        isBuiltin: false,
        isModified: false,
      },
    });

    expect(result).toMatchObject({ ok: false, type: 'action:save-prompt' });
  });

  it('rejects inherited message fields', () => {
    const input = Object.assign(
      Object.create({ type: 'action:refresh' }),
      { id: 'abc123' },
    );

    expect(parseWebviewMessage(input).ok).toBe(false);
  });

  it('rejects oversized action ids', () => {
    expect(parseWebviewMessage({
      type: 'action:refresh',
      id: 'a'.repeat(33),
    }).ok).toBe(false);
  });
});
```

Add companion `parseExtensionMessage` cases that reject:

- `state:update` with `ideStatuses: 'not-an-array'`.
- `auth:state` with an unknown status.
- `action:result` with a non-boolean `ok`.
- an unexpected top-level field on every tested message.
- a `DashboardState` carrying a browser executable path.
- a found browser summary without a stable `id`.
- a `DashboardState.storage.entries[]` value carrying a raw `path`.

- [ ] **Step 2: Run the shared test and observe red**

```powershell
pnpm --filter @airtable-formula/shared exec vitest run src/test/webview-contract.test.ts
```

Expected red result: `webview-contract.ts` does not exist and the old message union still permits arbitrary setting keys, paths, and browser choice objects.

- [ ] **Step 3: Introduce safe shared identifiers and snapshots**

In `types.ts`, add the public identifiers from this plan and replace the browser/storage/settings shapes with:

```ts
export type BrowserChannel = 'chrome' | 'msedge' | 'chromium';
export type BrowserId =
  | 'chrome'
  | 'edge'
  | 'chromium'
  | 'brave'
  | 'bundled-chromium'
  | 'custom-browser';
export type DetectedBrowserId = Exclude<BrowserId, 'custom-browser'>;
export type StorageEntryId = 'browser-profile' | 'tool-config' | 'bundled-chromium';
export type WebviewLinkId = 'docs' | 'changelog' | 'github' | 'chrome';
export type DashboardTabId = 'overview' | 'setup' | 'prompts' | 'settings';

export type BrowserInfo =
  | { found: false }
  | {
      found: true;
      id: BrowserId;
      channel: BrowserChannel;
      label: string;
      downloaded?: boolean;
    };

export type BrowserChoiceSummary =
  | { mode: 'auto' }
  | { mode: 'detected'; browserId: DetectedBrowserId; label: string }
  | { mode: 'custom'; label: string };

export interface StorageEntry {
  id: StorageEntryId;
  label: string;
  sizeBytes?: number;
  exists: boolean;
}
```

Add to `SettingsSnapshot.mcp`:

```ts
useDaemon: boolean;
browserIdleParkMinutes: number;
```

Change both `SettingsSnapshot.auth.browserChoice` and `AuthState.browserChoice` to `BrowserChoiceSummary | undefined`. The shared package must no longer export a type containing `executablePath`.

- [ ] **Step 4: Close the message unions**

Define the setting contract in `messages.ts`:

```ts
import type {
  DetectedBrowserId,
  DashboardState,
  IdeId,
  IdeStatus,
  AuthState,
  PromptDef,
  StorageEntryId,
  ToolCategories,
  ToolProfileName,
  TunnelProviderId,
  WebviewLinkId,
} from './types.js';

export type ActionId = string;
export type ConfirmationKind = 'discard-prompt-edits';

export type WebviewSettingChange =
  | { key: 'auth.autoRefresh'; value: boolean }
  | { key: 'auth.refreshIntervalHours'; value: number }
  | { key: 'auth.loginMode'; value: 'manual' | 'auto' }
  | { key: 'mcp.autoConfigureOnInstall'; value: boolean }
  | { key: 'mcp.notifyOnUpdates'; value: boolean }
  | { key: 'mcp.authMode'; value: 'browser' | 'byo' | 'direct-login' }
  | { key: 'mcp.httpClient'; value: 'fetch' | 'impit' }
  | { key: 'mcp.serverSource'; value: 'bundled' | 'npx' }
  | { key: 'mcp.daemonPort'; value: number }
  | { key: 'mcp.browserIdleParkMinutes'; value: number }
  | { key: 'mcp.toolProfile'; value: ToolProfileName }
  | { key: 'mcp.category'; category: keyof ToolCategories; value: boolean }
  | { key: 'formula.formatterVersion'; value: 'v1' | 'v2' }
  | {
      key: 'script.beautifyStyle';
      value: 'default' | 'compact' | 'singleQuote' | 'tabIndent' | 'semicolonFree';
    }
  | {
      key: 'script.minifyLevel';
      value: 'safe' | 'standard' | 'aggressive' | 'extreme';
    }
  | { key: 'ai.autoInstallFiles'; value: boolean }
  | { key: 'ai.includeAgents'; value: boolean }
  | { key: 'debug.enabled'; value: boolean }
  | { key: 'debug.verboseHttp'; value: boolean }
  | { key: 'debug.bufferSize'; value: number };

export type WebviewBrowserChoice =
  | { mode: 'auto' }
  | { mode: 'detected'; browserId: DetectedBrowserId };
```

Define the complete extension-to-webview union:

```ts
export type ExtensionMessage =
  | { type: 'state:update'; payload: DashboardState }
  | { type: 'ide:status'; payload: IdeStatus[] }
  | { type: 'auth:state'; payload: AuthState }
  | {
      type: 'action:result';
      id: ActionId;
      ok: boolean;
      error?: string;
      cancelled?: boolean;
    }
  | {
      type: 'confirmation:result';
      id: ActionId;
      confirmed: boolean;
    };
```

Define the complete webview-to-extension union:

```ts
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'action:setupIde'; id: ActionId; ideId: IdeId }
  | { type: 'action:setupAll'; id: ActionId }
  | { type: 'action:refresh'; id: ActionId }
  | { type: 'action:login'; id: ActionId }
  | { type: 'action:logout'; id: ActionId }
  | { type: 'action:status'; id: ActionId }
  | {
      type: 'action:saveCredentials';
      id: ActionId;
      email: string;
      password: string;
      otpSecret: string;
    }
  | { type: 'auth:saveCookie'; id: ActionId; cookie: string }
  | { type: 'auth:clearCookie'; id: ActionId }
  | { type: 'action:install-browser'; id: ActionId }
  | { type: 'action:removeBrowser'; id: ActionId }
  | { type: 'action:openToolConfig'; id: ActionId }
  | { type: 'action:unconfigureIde'; id: ActionId; ideId: IdeId }
  | { type: 'action:debug.startSession'; id: ActionId }
  | { type: 'action:debug.stopAndExport'; id: ActionId }
  | { type: 'action:debug.export'; id: ActionId }
  | { type: 'setting:change'; id: ActionId; change: WebviewSettingChange }
  | { type: 'action:manualLogin'; id: ActionId }
  | { type: 'action:openLink'; id: ActionId; link: WebviewLinkId }
  | { type: 'action:openIdeDocs'; id: ActionId; ideId: IdeId }
  | { type: 'action:openStoragePath'; id: ActionId; entryId: StorageEntryId }
  | { type: 'action:backupSession'; id: ActionId }
  | { type: 'action:restoreSession'; id: ActionId }
  | { type: 'action:selectCustomBrowser'; id: ActionId }
  | { type: 'action:setBrowserChoice'; id: ActionId; choice: WebviewBrowserChoice }
  | {
      type: 'tunnel:enable';
      id: ActionId;
      provider: TunnelProviderId;
      authtoken?: string;
      domain?: string;
    }
  | { type: 'tunnel:disable'; id: ActionId }
  | { type: 'tunnel:set-ngrok-authtoken'; id: ActionId; authtoken: string }
  | { type: 'daemon:start'; id: ActionId }
  | { type: 'daemon:stop'; id: ActionId }
  | { type: 'daemon:restart'; id: ActionId }
  | { type: 'daemon:copy-bearer-token'; id: ActionId }
  | { type: 'daemon:rotate-token'; id: ActionId }
  | { type: 'action:save-airtable-pat'; id: ActionId; pat: string }
  | { type: 'action:copy-airtable-pat'; id: ActionId }
  | { type: 'action:configure-official-airtable'; id: ActionId; ideId: IdeId }
  | { type: 'action:unconfigure-official-airtable'; id: ActionId; ideId: IdeId }
  | { type: 'action:save-prompt'; id: ActionId; prompt: PromptDef }
  | { type: 'action:delete-prompt'; id: ActionId; name: string }
  | { type: 'action:reset-prompt'; id: ActionId; name: string }
  | { type: 'confirmation:request'; id: ActionId; kind: ConfirmationKind };
```

- [ ] **Step 5: Implement strict parsers without adding a runtime dependency**

Create `webview-contract.ts`. Use own-property plain-object checks and exact-key checks:

```ts
import type {
  ExtensionMessage,
  WebviewMessage,
  WebviewSettingChange,
} from './messages.js';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; type?: string };

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  input: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(input, key))
    && Object.keys(input).every(key => allowed.has(key));
}

export function isActionId(input: unknown): input is string {
  return typeof input === 'string' && /^[a-z0-9]{6,32}$/.test(input);
}

export function parseWebviewMessage(input: unknown): ParseResult<WebviewMessage> {
  if (!isPlainRecord(input) || typeof input.type !== 'string') {
    return { ok: false, reason: 'message must be a plain object with an own type' };
  }

  return parseWebviewMessageByType(input.type, input);
}

export function parseExtensionMessage(input: unknown): ParseResult<ExtensionMessage> {
  if (!isPlainRecord(input) || typeof input.type !== 'string') {
    return { ok: false, reason: 'message must be a plain object with an own type' };
  }

  return parseExtensionMessageByType(input.type, input);
}
```

Implement `parseWebviewMessageByType` and `parseExtensionMessageByType` as exhaustive `switch` statements. Every arm must call `hasExactKeys`; a recognized type with extra keys is invalid.

Apply these limits:

| Field | Rule |
|---|---|
| Action ID | lowercase ASCII alphanumeric, 6–32 characters |
| Email | 1–320 characters |
| Password | 1–1024 characters |
| TOTP secret | 0–128 characters |
| Session cookie | 1–8192 characters |
| PAT or ngrok authtoken | 1–512 characters |
| Tunnel domain | 1–255 hostname characters, no scheme, slash, query, fragment, or whitespace |
| Prompt name | `^[a-z][a-z0-9-]{0,63}$` |
| Prompt arg name | `^[A-Za-z][A-Za-z0-9_-]{0,63}$` |
| Prompt description | 0–2048 characters |
| Prompt arguments | at most 16, unique names using exact case |
| Prompt template | 0–16384 characters |
| Daemon port | integer 0–65535 |
| Auth refresh interval | integer 1–168 hours |
| Browser idle park | integer 0–525600 minutes |
| Debug buffer size | integer 100–10000 |
| Every enum | exact declared membership |

Export these constants for the prompt editor so client and host validation cannot drift:

```ts
export const PROMPT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const PROMPT_ARG_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const MAX_PROMPT_ARGUMENTS = 16;
export const MAX_PROMPT_TEMPLATE_LENGTH = 16_384;
```

Validate every nested `DashboardState` field, including arrays and optional objects. Reject `executablePath` anywhere in extension-to-webview state. Return only the validated original object; do not coerce input.

Export both parsers and their supporting public types through `index.ts`.

- [ ] **Step 6: Run focused and package verification**

```powershell
pnpm --filter @airtable-formula/shared exec vitest run src/test/webview-contract.test.ts
pnpm --filter @airtable-formula/shared test
pnpm --filter @airtable-formula/shared build
```

Expected green result: all hostile payloads are rejected, all valid union arms have at least one acceptance test, and shared declaration generation succeeds.

- [ ] **Step 7: Commit the shared contract**

```powershell
git status --short
git add packages/shared/src/types.ts packages/shared/src/messages.ts packages/shared/src/webview-contract.ts packages/shared/src/index.ts packages/shared/src/test/webview-contract.test.ts
git commit -m "feat(shared): validate the webview message contract"
```

---

### Task 3: Enforce the contract and opaque capabilities in the extension host

**Files:**

- Modify: `packages/extension/src/webview/DashboardProvider.ts`
- Modify: `packages/extension/src/extension.ts`
- Modify: `packages/extension/src/settings.ts`
- Modify: `packages/extension/src/mcp/browser-detect.ts`
- Modify: `packages/extension/src/mcp/auth-manager.ts`
- Create: `packages/extension/src/test/webview-boundary.test.ts`
- Create: `packages/extension/src/test/browser-detect.test.ts`

**Interfaces:**

- Consumes: `parseWebviewMessage`, `WebviewSettingChange`, `BrowserId`, `StorageEntryId`, `WebviewLinkId`, and `ConfirmationKind`.
- Produces: a single `unknown` boundary, host-owned URL/path/executable resolution, an explicit webview settings setter, stable browser IDs, and native confirmations.

- [ ] **Step 1: Write extension-boundary tests before changing the handler**

Use the existing `vi.mock('vscode', ...)` test pattern. Cover these exact behaviors:

```ts
it('drops a malformed message before dispatching a side effect', async () => {
  inboundMessage({
    type: 'action:openStoragePath',
    id: 'abc123',
    path: 'C:\\Windows\\System32',
  });

  await vi.waitFor(() => {
    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(debugCollector.trace).toHaveBeenCalledWith(
      'ext',
      'webview',
      'webview:message_rejected',
      expect.objectContaining({ type: 'action:openStoragePath' }),
    );
  });
});

it('maps docs to the fixed Marketplace URL', async () => {
  inboundMessage({
    type: 'action:openLink',
    id: 'abc123',
    link: 'docs',
  });

  await vi.waitFor(() => {
    expect(vscode.env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        scheme: 'https',
        authority: 'marketplace.visualstudio.com',
      }),
    );
  });
});
```

Capture `inboundMessage` from the callback passed to the mocked webview's `onDidReceiveMessage` during `resolveWebviewView`. This tests the real registered boundary and avoids adding a production-only test seam.

Also test:

- unknown link IDs are rejected by the parser.
- each known IDE docs action maps to a fixed HTTPS URL.
- `browser-profile`, `tool-config`, and `bundled-chromium` resolve only from a freshly computed inventory.
- stale storage IDs do not call `openExternal`.
- detected browser IDs resolve against the latest `detectAllBrowsers()` result.
- a stale detected browser ID does not update configuration.
- custom paths are written only after the host file picker returns a Chromium-family executable.
- `setting:change` always posts a matching `action:result`.
- settings side effects complete before that `action:result`.
- webview-originated configuration events do not duplicate a daemon restart or IDE rewrite in `extension.ts`.
- delete and reset prompt actions call `showWarningMessage` with `{ modal: true }` before mutation.
- cancelling delete/reset posts `{ ok: false, cancelled: true }`.
- `confirmation:request` uses fixed host-owned copy and returns `confirmation:result`.
- rejected credential messages are traced without credential contents.
- `resolveWebviewView` sets `localResourceRoots` to exactly `dist/webview` under the extension URI.

- [ ] **Step 2: Run the focused tests and observe red**

```powershell
pnpm --filter airtable-formula exec vitest run src/test/webview-boundary.test.ts src/test/browser-detect.test.ts
```

Expected red result: the current provider casts inbound data, accepts raw paths and browser objects, routes arbitrary `_openUrl`, and has no stable browser ID.

- [ ] **Step 3: Add stable host browser IDs**

In `browser-detect.ts`, make every found probe carry an ID:

```ts
import type { BrowserChannel, BrowserId } from '@airtable-formula/shared';

export type BrowserProbe =
  | { found: false }
  | {
      found: true;
      id: BrowserId;
      channel: BrowserChannel;
      executablePath: string;
      label: string;
      downloaded?: boolean;
    };
```

Use these fixed mappings:

```ts
{ id: 'chrome', channel: 'chrome', label: 'Google Chrome' }
{ id: 'edge', channel: 'msedge', label: 'Microsoft Edge' }
{ id: 'chromium', channel: 'chromium', label: 'Chromium' }
{ id: 'brave', channel: 'chromium', label: 'Brave Browser' }
{ id: 'bundled-chromium', channel: 'chromium', label: 'Bundled Chromium', downloaded: true }
```

Keep `executablePath` host-only. In `auth-manager.ts`, map probes to `BrowserInfo` without the path and map the persisted host choice to `BrowserChoiceSummary`.

Define the persisted host-only type in `settings.ts`, not shared:

```ts
export type HostBrowserChoice =
  | { mode: 'auto' }
  | {
      mode: 'custom';
      channel: 'chrome' | 'msedge' | 'chromium';
      executablePath: string;
      label: string;
      detectedId?: import('@airtable-formula/shared').BrowserId;
    };
```

When resolving a host-picked custom executable, use `id: 'custom-browser'` in the active `BrowserProbe`; never add that ID to `WebviewBrowserChoice`, and never treat it as a detected selectable option.

- [ ] **Step 4: Add the only permitted webview settings entrypoint**

In `settings.ts`, implement:

```ts
export async function updateWebviewSetting(
  change: import('@airtable-formula/shared').WebviewSettingChange,
): Promise<void> {
  if (change.key === 'mcp.category') {
    throw new Error('Tool categories must be updated through ToolProfileManager');
  }

  await updateSetting(change.key, change.value);
}
```

The provider routes `mcp.toolProfile` and `mcp.category` through `ToolProfileManager`; every other union arm routes through `updateWebviewSetting`. There is no `string` key path from the webview.

- [ ] **Step 5: Serialize setting side effects and acknowledge only completed work**

Use this explicit behavior matrix:

| Setting keys | Required work before `action:result` |
|---|---|
| `auth.autoRefresh`, `auth.refreshIntervalHours` | persist, restart auto-refresh, push state |
| `auth.loginMode` | persist, push state |
| `mcp.serverSource` | persist, rewrite every configured IDE MCP entry, push state |
| `mcp.authMode`, `mcp.httpClient`, `mcp.browserIdleParkMinutes` | persist, await `applyTransportSettingChange()`, push state |
| `mcp.daemonPort` | persist and push state; do not restart automatically; UI says it applies on the next explicit service start/restart |
| `mcp.toolProfile` | await `ToolProfileManager.setProfile()`, push state |
| `mcp.category` | await `ToolProfileManager.toggleCategory()`, push state |
| `debug.enabled` | persist, update `DebugCollector.enabled`, push state |
| `debug.bufferSize` | persist, resize the debug collector, push state |
| `debug.verboseHttp` | persist, push state |
| `mcp.autoConfigureOnInstall`, `mcp.notifyOnUpdates`, `ai.*`, `formula.*`, `script.*` | persist, push state |

`mcp.useDaemon` is snapshot-only in the webview contract. It remains configurable through native VS Code settings, but the webview cannot switch process topology as a generic setting write. Advanced Runtime displays the current mode read-only with `Change this in VS Code Settings, then reload the window to switch transport modes.` This explicitly preserves the existing reload boundary instead of showing a premature success for a partial live topology change.

Refactor `extension.ts` and `DashboardProvider.ts` so native settings changes and webview changes call the same public side-effect method. Make it single-flight by setting key:

```ts
type ConfigurationSideEffectKey =
  | 'auth.autoRefresh'
  | 'auth.refreshIntervalHours'
  | 'mcp.serverSource'
  | 'mcp.authMode'
  | 'mcp.httpClient'
  | 'mcp.browserIdleParkMinutes'
  | 'debug.enabled'
  | 'debug.bufferSize';

private readonly settingEffects =
  new Map<ConfigurationSideEffectKey, Promise<void>>();

async applyConfigurationSideEffect(
  key: ConfigurationSideEffectKey,
): Promise<void> {
  const current = this.settingEffects.get(key);
  if (current) return current;

  const running = this.performConfigurationSideEffect(key).finally(() => {
    setTimeout(() => {
      if (this.settingEffects.get(key) === running) {
        this.settingEffects.delete(key);
      }
    }, 0);
  });
  this.settingEffects.set(key, running);
  return running;
}
```

`performConfigurationSideEffect` accepts only the finite keys in the matrix, not arbitrary strings. The one-tick retention lets the `onDidChangeConfiguration` callback and the originating webview handler share the same promise instead of restarting a daemon or rewriting editor files twice.

The `setting:change` handler wraps persist → required side effect → `pushState()` in `try/catch`; it posts success only after all three complete. Failure posts the matching error outcome.

- [ ] **Step 6: Gate the provider boundary before dispatch**

Wire the listener as:

```ts
webviewView.webview.onDidReceiveMessage(input => {
  void this.handleIncomingMessage(input);
});
```

Implement:

```ts
private async handleIncomingMessage(input: unknown): Promise<void> {
  const parsed = parseWebviewMessage(input);
  if (!parsed.ok) {
    this._debugCollector?.trace('ext', 'webview', 'webview:message_rejected', {
      type: parsed.type ?? 'unknown',
      reason: parsed.reason,
    });
    return;
  }

  await this.handleMessage(parsed.value);
}
```

- [ ] **Step 7: Replace raw capability payloads with host maps**

Add fixed maps next to the provider:

```ts
const WEBVIEW_LINKS: Record<WebviewLinkId, string> = {
  docs: 'https://marketplace.visualstudio.com/items?itemName=Nskha.airtable-formula',
  changelog: 'https://github.com/Automations-Project/VSCode-Airtable-Formula/blob/main/CHANGELOG.md',
  github: 'https://github.com/Automations-Project/VSCode-Airtable-Formula',
  chrome: 'https://www.google.com/chrome/',
};

const IDE_DOCS_LINKS: Record<IdeId, string> = {
  cursor: 'https://cursor.com/download',
  windsurf: 'https://windsurf.com/download',
  'windsurf-next': 'https://windsurf.com/download',
  'claude-code': 'https://docs.claude.com/en/docs/claude-code/quickstart',
  'claude-desktop': 'https://claude.ai/download',
  cline: 'https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev',
  amp: 'https://ampcode.com/',
  opencode: 'https://opencode.ai',
  'codex-cli': 'https://github.com/openai/codex',
  zed: 'https://zed.dev/download',
  helix: 'https://helix-editor.com',
  neovim: 'https://neovim.io',
};
```

For storage, keep a private host inventory and derive the safe snapshot:

```ts
interface HostStorageEntry extends StorageEntry {
  path: string;
}

const inventory: HostStorageEntry[] = [];
inventory.push(await this._storageEntry('browser-profile', 'Browser Profile', profileDir, fsP));
inventory.push(await this._storageEntry('tool-config', 'Tool Config', toolConfig, fsP));
inventory.push(await this._storageEntry('bundled-chromium', 'Bundled Chromium', storageDir, fsP));

const info: StorageInfo = {
  entries: inventory.map(({ path: _path, ...entry }) => entry),
};
```

Make `_computeStorageInventory()` return `HostStorageEntry[]`; make `_computeStorageInfo()` strip the private path as shown. When opening storage, recompute the host inventory, find `entry.id === msg.entryId`, require `entry.exists`, then call `vscode.env.openExternal(vscode.Uri.file(entry.path))`. Never send the path to the webview and never open a path supplied by it.

For browser selection, recompute `detectAllBrowsers(downloadedPath)`, find the selected ID, and persist its host-only path only after that match.

- [ ] **Step 8: Add native confirmation handling**

Use fixed copy:

```ts
const CONFIRMATION_COPY: Record<ConfirmationKind, string> = {
  'discard-prompt-edits': 'Discard unsaved prompt changes?',
};
```

For `confirmation:request`, call:

```ts
const choice = await vscode.window.showWarningMessage(
  CONFIRMATION_COPY[msg.kind],
  { modal: true },
  'Discard',
);

this.view?.webview.postMessage({
  type: 'confirmation:result',
  id: msg.id,
  confirmed: choice === 'Discard',
});
```

Use separate fixed modal text for prompt delete and reset, naming the prompt but never accepting host behavior from free-form webview text.

`confirmation:request/result` is used only for unsaved prompt navigation. Delete and reset do not send a confirmation request: their existing action messages enter the host handler, the host opens its native modal, and cancellation returns `action:result { ok: false, cancelled: true }`. This is the only delete/reset confirmation path.

Extend `postResult` without changing existing call sites:

```ts
private postResult(
  id: string,
  ok: boolean,
  error?: string,
  cancelled?: boolean,
): void {
  this.view?.webview.postMessage({
    type: 'action:result',
    id,
    ok,
    error,
    cancelled,
  });
}
```

- [ ] **Step 9: Verify host hardening**

```powershell
pnpm --filter airtable-formula exec vitest run src/test/webview-boundary.test.ts src/test/browser-detect.test.ts
pnpm --filter airtable-formula test
pnpm --filter airtable-formula build
```

Expected green result: malformed messages reach no side effects, settings are allowlisted, opaque IDs resolve host-side, native confirmations are covered, and extension compilation succeeds.

- [ ] **Step 10: Commit only host-boundary files**

```powershell
git status --short
git add packages/extension/src/webview/DashboardProvider.ts packages/extension/src/extension.ts packages/extension/src/settings.ts packages/extension/src/mcp/browser-detect.ts packages/extension/src/mcp/auth-manager.ts packages/extension/src/test/webview-boundary.test.ts packages/extension/src/test/browser-detect.test.ts
git commit -m "feat(extension): harden the webview trust boundary"
```

---

### Task 4: Migrate the webview sender, receiver, action feedback, and safe persistence

**Files:**

- Modify: `packages/webview/src/lib/utils.ts`
- Modify: `packages/webview/src/lib/vscode.ts`
- Create: `packages/webview/src/lib/confirmation.ts`
- Modify: `packages/webview/src/store.ts`
- Modify: `packages/webview/src/App.tsx`
- Modify: `packages/webview/src/test/store.test.ts`
- Modify: `packages/webview/src/test/app.render.test.tsx`
- Create: `packages/webview/src/test/confirmation.test.ts`

**Interfaces:**

- Consumes: strict shared message parsers and DTOs.
- Produces: cryptographic action IDs, an `unknown` message listener, active-tab-only persistence, action outcomes with error/cancellation, and a bounded host-confirmation promise bridge.

- [ ] **Step 1: Add failing sender/receiver/persistence tests**

Extend the store tests with exact message expectations:

```ts
it('opens storage by opaque id', () => {
  useStore.getState().openStoragePath('tool-config');

  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'action:openStoragePath',
    entryId: 'tool-config',
  }));
  expect(postMessage.mock.calls[0]?.[0]).not.toHaveProperty('path');
});

it('sends detected browser id without an executable', () => {
  useStore.getState().setBrowserChoice({
    mode: 'detected',
    browserId: 'chrome',
  });

  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'action:setBrowserChoice',
    choice: { mode: 'detected', browserId: 'chrome' },
  }));
});

it('persists only the active tab', () => {
  useStore.getState().setTab('settings');

  expect(setState).toHaveBeenCalledWith({ activeTab: 'settings' });
});
```

Add rendered tests that dispatch `MessageEvent` values:

```tsx
it('ignores a malformed extension state update', () => {
  render(<App />);

  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'state:update', payload: { ideStatuses: 'not-an-array' } },
  }));

  expect(useStore.getState().loading).toBe(true);
});

it('keeps host action error text for local feedback', () => {
  useStore.setState({
    pendingActions: new Set(['abc123']),
  });
  render(<App />);

  window.dispatchEvent(new MessageEvent('message', {
    data: {
      type: 'action:result',
      id: 'abc123',
      ok: false,
      error: 'Could not save settings',
    },
  }));

  expect(useStore.getState().consumeActionResult('abc123')).toEqual({
    ok: false,
    error: 'Could not save settings',
  });
});
```

In `confirmation.test.ts`, use fake timers to assert that a confirmed reply resolves `true`, a negative reply resolves `false`, and a 60-second timeout resolves `false` and deletes its resolver.

Add a rendered persistence test using `vscodeApiMock` from `test-setup.ts`:

```tsx
it('restores the persisted active tab when App mounts', async () => {
  vscodeApiMock.getState.mockReturnValue({ activeTab: 'prompts' });
  useStore.setState({ activeTab: 'overview', loading: false });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByRole('tab', { name: 'Prompts' }))
      .toHaveAttribute('aria-selected', 'true');
  });
  expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Prompts');
});
```

- [ ] **Step 2: Run focused tests and observe red**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/store.test.ts src/test/app.render.test.tsx src/test/confirmation.test.ts
```

Expected red result: the store still sends paths and host-shaped browser choices, errors are discarded, state is not persisted, and no confirmation bridge exists.

- [ ] **Step 3: Generate valid cryptographic action IDs**

Replace `randomId` with:

```ts
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
```

This produces exactly 24 lowercase hexadecimal characters, satisfying the shared parser.

- [ ] **Step 4: Make the VS Code bridge honest about unknown input**

In `lib/vscode.ts`:

```ts
export interface PersistedWebviewState {
  activeTab?: import('@shared/types.js').DashboardTabId;
}

export function getPersistedState(): PersistedWebviewState | undefined {
  if (!vscodeApi) return undefined;
  const value = vscodeApi.getState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const activeTab = (value as { activeTab?: unknown }).activeTab;
  if (!['overview', 'setup', 'prompts', 'settings'].includes(String(activeTab))) {
    return undefined;
  }
  return { activeTab: activeTab as PersistedWebviewState['activeTab'] };
}

export function setPersistedState(state: PersistedWebviewState): void {
  vscodeApi?.setState({ activeTab: state.activeTab });
}

export function onExtensionMessage(handler: (input: unknown) => void): () => void {
  const listener = (event: MessageEvent<unknown>) => handler(event.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
```

- [ ] **Step 5: Add the confirmation bridge**

Create `lib/confirmation.ts`:

```ts
import type { ConfirmationKind } from '@shared/messages.js';
import { randomId } from './utils.js';
import { sendToExtension } from './vscode.js';

const TIMEOUT_MS = 60_000;
const pending = new Map<string, {
  resolve: (confirmed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

export function requestHostConfirmation(kind: ConfirmationKind): Promise<boolean> {
  const id = randomId();
  sendToExtension({ type: 'confirmation:request', id, kind });
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, TIMEOUT_MS);
    pending.set(id, { resolve, timer });
  });
}

export function resolveHostConfirmation(id: string, confirmed: boolean): void {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  entry.resolve(confirmed);
}
```

- [ ] **Step 6: Update store signatures and outcomes**

Use:

```ts
openLink: (link: WebviewLinkId) => string;
openIdeDocs: (ideId: IdeId) => string;
openStoragePath: (entryId: StorageEntryId) => string;
setBrowserChoice: (choice: WebviewBrowserChoice) => string;
changeSetting: (change: WebviewSettingChange) => string;
applyIdeStatus: (statuses: IdeStatus[]) => void;
hydratePersistedState: () => void;
markActionDone: (id: string, outcome: ActionOutcome) => void;
consumeActionResult: (id: string) => ActionOutcome | undefined;
```

Every mutating message, including save/clear cookie, receives a generated action ID and uses `beginAction`. Replace the external `Map<string, boolean>` with `Map<string, ActionOutcome>` and preserve the current 50-result eviction bound.

Initialize `activeTab` to `overview`, then add:

```ts
hydratePersistedState: () => {
  const persisted = getPersistedState();
  if (persisted?.activeTab) set({ activeTab: persisted.activeTab });
},
```

App calls `hydratePersistedState()` once in its mount effect before sending `ready`. Implement tab writes as:

```ts
setTab: tab => {
  set({ activeTab: tab });
  setPersistedState({ activeTab: tab });
},
```

Add `settings.mcp.useDaemon: true` and `browserIdleParkMinutes: 30` to the default snapshot.

- [ ] **Step 7: Parse inbound extension messages before store mutation**

In `App`, call `parseExtensionMessage(input)`. On failure, log only `type` and `reason`, not the payload. On success:

```ts
if (message.type === 'state:update') applyState(message.payload);
if (message.type === 'ide:status') applyIdeStatus(message.payload);
if (message.type === 'auth:state') applyAuthState(message.payload);
if (message.type === 'action:result') {
  markActionDone(message.id, {
    ok: message.ok,
    error: message.error,
    cancelled: message.cancelled,
  });
}
if (message.type === 'confirmation:result') {
  resolveHostConfirmation(message.id, message.confirmed);
}
```

Keep the initial `{ type: 'ready' }` message.

- [ ] **Step 8: Verify the coordinated contract migration**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/store.test.ts src/test/app.render.test.tsx src/test/confirmation.test.ts
pnpm --filter @airtable-formula/webview test
pnpm --filter @airtable-formula/webview build
pnpm --filter airtable-formula build
```

Expected green result: no raw URL/path/executable leaves the webview, invalid host messages do not mutate state, action errors survive for local feedback, and only `activeTab` is persisted.

- [ ] **Step 9: Commit the coordinated webview migration**

```powershell
git status --short
git add packages/webview/src/lib/utils.ts packages/webview/src/lib/vscode.ts packages/webview/src/lib/confirmation.ts packages/webview/src/store.ts packages/webview/src/App.tsx packages/webview/src/test/store.test.ts packages/webview/src/test/app.render.test.tsx packages/webview/src/test/confirmation.test.ts
git commit -m "feat(webview): adopt the hardened host contract"
```

---

### Task 5: Build the semantic CSS foundation, app shell, and complete tab keyboard model

**Files:**

- Modify: `packages/webview/package.json`
- Modify: `packages/webview/vite.config.ts`
- Modify: `packages/webview/src/styles.css`
- Create: `packages/webview/src/styles/tokens.css`
- Create: `packages/webview/src/styles/base.css`
- Create: `packages/webview/src/styles/app-shell.css`
- Create: `packages/webview/src/styles/sections.css`
- Create: `packages/webview/src/styles/legacy.css`
- Create: `packages/webview/src/styles/accessibility.css`
- Create: `packages/webview/src/components/AppShell.tsx`
- Create: `packages/webview/src/components/DashboardTabs.tsx`
- Create: `packages/webview/src/components/Section.tsx`
- Create: `packages/webview/src/components/Feedback.tsx`
- Create: `packages/webview/src/components/ActionButton.tsx`
- Create: `packages/webview/src/tabs/settings/SupportAboutSection.tsx`
- Modify: `packages/webview/src/App.tsx`
- Modify: `packages/webview/src/tabs/Settings.tsx`
- Modify: `packages/webview/src/components/AirtableLogo.tsx`
- Create: `packages/webview/src/test/dashboard-tabs.test.tsx`
- Modify: `packages/webview/src/test/app.render.test.tsx`
- Create: `packages/webview/src/test/support-about.test.tsx`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `DashboardTabId`, `activeTab`, `setTab`, `versions`, and opaque `openLink`.
- Produces: VS Code-native semantic tokens, a quiet shell, equal-width WAI-ARIA tabs, a single tabpanel, support/about in Settings, and foundational action/status primitives.

- [ ] **Step 1: Write interaction tests for the missing tab behavior**

Create `dashboard-tabs.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DashboardTabs } from '../components/DashboardTabs.js';

const tabs = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'setup' as const, label: 'Setup' },
  { id: 'prompts' as const, label: 'Prompts' },
  { id: 'settings' as const, label: 'Settings' },
];

describe('DashboardTabs', () => {
  it('uses one roving tab stop', () => {
    render(
      <DashboardTabs
        tabs={tabs}
        activeTab="setup"
        onRequestSelect={() => true}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Setup' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Prompts' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('tabindex', '-1');
  });

  it('automatically activates arrows, Home, End, and wrapping', async () => {
    const user = userEvent.setup();
    const onRequestSelect = vi.fn().mockResolvedValue(true);
    render(
      <DashboardTabs
        tabs={tabs}
        activeTab="overview"
        onRequestSelect={onRequestSelect}
      />,
    );

    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    await user.keyboard('{ArrowRight}');
    expect(onRequestSelect).toHaveBeenLastCalledWith('setup');
    expect(screen.getByRole('tab', { name: 'Setup' })).toHaveFocus();

    await user.keyboard('{End}');
    expect(onRequestSelect).toHaveBeenLastCalledWith('settings');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(onRequestSelect).toHaveBeenLastCalledWith('overview');
    expect(overview).toHaveFocus();

    await user.keyboard('{Home}');
    expect(onRequestSelect).toHaveBeenLastCalledWith('overview');
  });
});
```

Extend `app.render.test.tsx` to assert:

- `tablist` is named `Dashboard sections`.
- selected tab has `aria-controls="dashboard-panel-overview"`.
- the visible panel has `aria-labelledby="dashboard-tab-overview"`.
- clicking a top tab leaves focus on that tab; it does not force focus into the panel.
- no persistent footer exists.

In `support-about.test.tsx`, render the real Settings tab and assert buttons named `Open documentation`, `Open changelog`, and `Open GitHub repository` call `openLink` with `docs`, `changelog`, and `github`.

- [ ] **Step 2: Run the focused tests and observe red**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/dashboard-tabs.test.tsx src/test/app.render.test.tsx src/test/support-about.test.tsx
```

Expected red result: tabs lack roving `tabIndex` and keyboard behavior, the old footer still renders, and Support/About does not exist in Settings.

- [ ] **Step 3: Remove the unused visual toolchain**

Run:

```powershell
pnpm --filter @airtable-formula/webview remove motion tailwindcss @tailwindcss/vite
```

Remove the Tailwind import from `styles.css`, remove the Tailwind Vite import, and leave `plugins: [react()]`.

- [ ] **Step 4: Establish explicit CSS layers and semantic tokens**

Make `styles.css` import-only:

```css
@layer reset, tokens, base, components, utilities, states, accessibility;

@import './styles/tokens.css' layer(tokens);
@import './styles/base.css' layer(base);
@import './styles/app-shell.css' layer(components);
@import './styles/sections.css' layer(components);
@import './styles/legacy.css' layer(components);
@import './styles/accessibility.css' layer(accessibility);
```

In `tokens.css`, define:

```css
:root {
  color-scheme: light dark;

  --surface-base: var(--vscode-sideBar-background, #1f1f1f);
  --surface-raised: var(--vscode-editorWidget-background, #252526);
  --surface-input: var(--vscode-input-background, #313131);
  --surface-hover: var(--vscode-list-hoverBackground, #2a2d2e);
  --surface-active: var(--vscode-list-activeSelectionBackground, #04395e);

  --text-primary: var(--vscode-foreground, #cccccc);
  --text-secondary: var(--vscode-descriptionForeground, #9d9d9d);
  --text-link: var(--vscode-textLink-foreground, #3794ff);
  --text-link-active: var(--vscode-textLink-activeForeground, #4daafc);
  --text-danger: var(--vscode-errorForeground, #f48771);

  --border-default: var(--vscode-panel-border, #3c3c3c);
  --border-input: var(--vscode-input-border, var(--border-default));
  --focus-ring: var(--vscode-focusBorder, #007fd4);

  --status-success: var(--vscode-testing-iconPassed, #73c991);
  --status-warning: var(--vscode-editorWarning-foreground, #cca700);
  --status-error: var(--vscode-testing-iconFailed, #f14c4c);
  --status-info: var(--vscode-notificationsInfoIcon-foreground, #75beff);

  --brand-session: #166ee1;
  --brand-service: #18bfff;
  --brand-clients: #fcb400;
  --brand-attention: #f82b60;

  --font-ui: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  --font-mono: var(--vscode-editor-font-family, 'SFMono-Regular', Consolas, monospace);

  --space-1: 4px;
  --space-2: 6px;
  --space-3: 8px;
  --space-4: 12px;
  --space-5: 16px;
  --space-6: 20px;

  --radius-1: 2px;
  --radius-2: 4px;
  --radius-3: 6px;
}
```

In `base.css`, reset margins/box sizing, use `font-size: 12px`, never render body text below 11px, give interactive controls at least 28px height, and define:

```css
:where(button, a, input, select, textarea, summary):focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
```

Move the still-needed pre-migration `.btn`, `.chip`, `.stack`, `.list-row`, `.toggle-*`, `.select-input`, `.action-card`, and `.glass-panel` rules into `legacy.css`. Map their colors to the semantic tokens and do not carry the ambient orb/loader rules forward. Tasks 6–11 delete legacy selectors as each owning surface migrates; Task 12 deletes the file after a no-reference check. This keeps intermediate commits usable without preserving the retired system in the final build.

- [ ] **Step 5: Implement the complete tabs primitive**

Create `DashboardTabs.tsx`:

```tsx
import React, { useRef } from 'react';
import type { DashboardTabId } from '@shared/types.js';

interface DashboardTabsProps {
  tabs: readonly { id: DashboardTabId; label: string }[];
  activeTab: DashboardTabId;
  onRequestSelect: (id: DashboardTabId) => boolean | Promise<boolean>;
}

export function DashboardTabs({
  tabs,
  activeTab,
  onRequestSelect,
}: DashboardTabsProps) {
  const refs = useRef(new Map<DashboardTabId, HTMLButtonElement>());

  async function requestActivate(index: number): Promise<void> {
    const normalized = (index + tabs.length) % tabs.length;
    const next = tabs[normalized];
    const accepted = await onRequestSelect(next.id);
    refs.current.get(accepted ? next.id : activeTab)?.focus();
  }

  function onKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      void requestActivate(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      void requestActivate(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      void requestActivate(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      void requestActivate(tabs.length - 1);
    }
  }

  return (
    <div className="app-tabs" role="tablist" aria-label="Dashboard sections">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={node => {
            if (node) refs.current.set(tab.id, node);
            else refs.current.delete(tab.id);
          }}
          id={`dashboard-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`dashboard-panel-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          className="app-tab"
          onClick={() => {
            void requestActivate(index);
          }}
          onKeyDown={event => onKeyDown(event, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

Update the tests to pass `onRequestSelect`. Successful test callbacks return `true`; add one rejection case returning `false` and assert focus returns to the currently selected tab.

- [ ] **Step 6: Build the shell and move support links**

`AppShell` owns:

- a 40px header with the Airtable mark, `Airtable Control`, and concise aggregate status text;
- `DashboardTabs`;
- one scroll container;
- one rendered `tabpanel`;
- no footer, ambient orb, gradient wash, version chip, or looping loading animation.

The panel must be:

```tsx
<main
  id={`dashboard-panel-${activeTab}`}
  role="tabpanel"
  aria-labelledby={`dashboard-tab-${activeTab}`}
  className="app-panel"
>
  {children}
</main>
```

Replace the loading screen with a static `Feedback` using `role="status"` and text `Loading Airtable Control…`.

`SupportAboutSection` renders version data and four buttons using `openLink`: documentation, changelog, GitHub, and Chrome. Render it at the bottom of the current Settings content before the later Settings regroup.

Make `AirtableLogo` accept `className?: string` and use CSS size classes rather than an inline width/height.

- [ ] **Step 7: Add theme, reflow, and motion floors**

In `accessibility.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}

.vscode-reduce-motion *,
.vscode-reduce-motion *::before,
.vscode-reduce-motion *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  scroll-behavior: auto !important;
  transition-duration: 0.01ms !important;
}

@media (max-width: 320px) {
  .app-header {
    padding-inline: var(--space-3);
  }

  .app-panel {
    padding: var(--space-3);
  }

  .app-status {
    max-width: 44%;
  }
}

.vscode-high-contrast .section,
.vscode-high-contrast-light .section {
  border-color: var(--vscode-contrastBorder, currentColor);
}
```

All transitions in this slice must name specific properties. Add a rendered CSS test that adds `vscode-reduce-motion` to `document.body`, renders an `ActionButton`, and asserts its computed `transitionDuration` is `0.01ms`; the Vitest `css: true` setting from Task 1 makes this a runtime CSS contract rather than a source-grep test.

- [ ] **Step 8: Verify the shell**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/dashboard-tabs.test.tsx src/test/app.render.test.tsx src/test/support-about.test.tsx
pnpm --filter @airtable-formula/webview test
pnpm --filter @airtable-formula/webview build
node -e "const fs=require('node:fs'),z=require('node:zlib');const kb=z.gzipSync(fs.readFileSync('packages/extension/dist/webview/main.js')).length/1024;console.log('main.js gzip='+kb.toFixed(2)+' KiB');if(kb>90)process.exit(1)"
```

Expected green result: tabs pass the WAI-ARIA automatic-activation keyboard model, support links remain reachable through opaque IDs, the footer is gone, and the app builds without Tailwind or Motion.

- [ ] **Step 9: Commit the shell and CSS foundation**

```powershell
git status --short
git add packages/webview/package.json packages/webview/vite.config.ts packages/webview/src/styles.css packages/webview/src/styles/tokens.css packages/webview/src/styles/base.css packages/webview/src/styles/app-shell.css packages/webview/src/styles/sections.css packages/webview/src/styles/legacy.css packages/webview/src/styles/accessibility.css packages/webview/src/components/AppShell.tsx packages/webview/src/components/DashboardTabs.tsx packages/webview/src/components/Section.tsx packages/webview/src/components/Feedback.tsx packages/webview/src/components/ActionButton.tsx packages/webview/src/tabs/settings/SupportAboutSection.tsx packages/webview/src/App.tsx packages/webview/src/tabs/Settings.tsx packages/webview/src/components/AirtableLogo.tsx packages/webview/src/test/dashboard-tabs.test.tsx packages/webview/src/test/app.render.test.tsx packages/webview/src/test/support-about.test.tsx pnpm-lock.yaml
git commit -m "feat(webview): add the native workbench shell"
```

---

### Task 6: Implement the live readiness formula and redesign Overview

**Files:**

- Create: `packages/webview/src/selectors/readiness.ts`
- Create: `packages/webview/src/components/ReadinessFormula.tsx`
- Create: `packages/webview/src/components/NextAction.tsx`
- Create: `packages/webview/src/components/StatusSummary.tsx`
- Create: `packages/webview/src/tabs/overview/OverviewHero.tsx`
- Create: `packages/webview/src/tabs/overview/OverviewClients.tsx`
- Create: `packages/webview/src/tabs/overview/OverviewLinks.tsx`
- Modify: `packages/webview/src/tabs/Overview.tsx`
- Modify: `packages/webview/src/App.tsx`
- Create: `packages/webview/src/styles/readiness.css`
- Modify: `packages/webview/src/styles.css`
- Create: `packages/webview/src/test/readiness.test.ts`
- Create: `packages/webview/src/test/overview.test.tsx`

**Interfaces:**

- Consumes: `DashboardState`, `SettingsSnapshot.mcp.useDaemon`, `AuthState`, daemon/tunnel state, IDE status, and store actions.
- Produces: pure `ReadinessModel`, the visual signature `{SESSION}+{SERVICE}+{CLIENTS}=READY`, exactly one primary next action, ordered issues, compact client summary, and focus-targeted cross-tab navigation.

- [ ] **Step 1: Specify the readiness decision table in tests**

Create `readiness.test.ts` using `makeDashboardState()`:

```ts
import { describe, expect, it } from 'vitest';
import { makeDashboardState } from './dashboard-state.fixture.js';
import { selectReadiness } from '../selectors/readiness.js';

describe('selectReadiness', () => {
  it('prioritizes a missing browser before session, service, and clients', () => {
    const model = selectReadiness(makeDashboardState({
      auth: {
        status: 'chrome-missing',
        hasCredentials: false,
        browser: { found: false },
      },
      daemon: undefined,
      ideStatuses: [],
    }));

    expect(model.state).toBe('blocked');
    expect(model.headline).toBe('Install a browser to start a session');
    expect(model.nextAction).toMatchObject({
      kind: 'open-tab',
      tab: 'settings',
      focusTargetId: 'browser-settings-heading',
    });
  });

  it('does not call stdio a stopped daemon', () => {
    const state = makeDashboardState({
      settings: {
        mcp: { useDaemon: false },
      },
      daemon: undefined,
    });

    const model = selectReadiness(state);

    expect(model.transportMode).toBe('stdio');
    expect(model.terms.service.state).toBe('inactive');
    expect(model.terms.service.longLabel).toBe('Direct stdio');
    expect(model.issues.map(issue => issue.title)).not.toContain('Local service stopped');
  });

  it('blocks on an unhealthy required daemon before clients', () => {
    const model = selectReadiness(makeDashboardState({
      daemon: {
        running: true,
        healthy: false,
        port: 8723,
        port_lsp: null,
        tunnelUrl: null,
        uptime: 1000,
      },
      ideStatuses: [],
    }));

    expect(model.headline).toBe('Repair the local service');
    expect(model.nextAction).toMatchObject({
      tab: 'setup',
      focusTargetId: 'local-service-heading',
    });
  });

  it('is degraded when one client works and another is partial', () => {
    const state = makeDashboardState({
      ideStatuses: [
        makeDashboardState().ideStatuses[0],
        {
          ideId: 'claude-code',
          label: 'Claude Code',
          detected: true,
          mcpConfigured: false,
          aiFiles: {
            skills: 'partial',
            rules: 'missing',
            workflows: 'missing',
            agents: 'missing',
          },
        },
      ],
    });

    expect(selectReadiness(state).state).toBe('degraded');
  });

  it('is ready with a valid session, usable transport, and one usable client', () => {
    const model = selectReadiness(makeDashboardState());

    expect(model.state).toBe('ready');
    expect(model.headline).toBe('Airtable is ready');
    expect(model.nextAction).toBeNull();
  });
});
```

Add cases for `loading`, expired/error session, stopped daemon, no usable client, daemon starting, tunnel error, and partially configured detected clients. Assert the priority order is browser, session, service when enabled, clients, degraded repair, ready.

- [ ] **Step 2: Run the selector test and observe red**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/readiness.test.ts
```

Expected red result: no readiness selector or model exists.

- [ ] **Step 3: Implement the pure readiness contract**

Use:

```ts
export type ReadinessState = 'loading' | 'blocked' | 'degraded' | 'ready';
export type ReadinessTermState =
  | 'loading'
  | 'ready'
  | 'blocked'
  | 'degraded'
  | 'inactive';

export interface ReadinessTerm {
  key: 'session' | 'service' | 'clients';
  state: ReadinessTermState;
  shortLabel: string;
  longLabel: string;
  accent: 'session' | 'service' | 'clients' | 'neutral';
}

export interface ReadinessAction {
  kind: 'open-tab' | 'dispatch';
  label: string;
  tab?: import('@shared/types.js').DashboardTabId;
  dispatchType?:
    | 'action:login'
    | 'action:install-browser'
    | 'daemon:start'
    | 'action:setupIde'
    | 'action:setupAll'
    | 'action:status';
  ideId?: import('@shared/types.js').IdeId;
  focusTargetId?: string;
}

export interface ReadinessIssue {
  id: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  tab: import('@shared/types.js').DashboardTabId;
  focusTargetId?: string;
}

export interface ReadinessModel {
  state: ReadinessState;
  transportMode: 'daemon' | 'stdio';
  terms: {
    session: ReadinessTerm;
    service: ReadinessTerm;
    clients: ReadinessTerm;
  };
  headline: string;
  detail: string;
  nextAction: ReadinessAction | null;
  issues: ReadinessIssue[];
  usableClientCount: number;
}
```

Treat a detected MCP client as usable when `mcpConfigured === true` and `mcpServerHealthy !== false`. Treat `zed`, `helix`, and `neovim` as usable when `lspConfigured === true`. Missing/partial AI files create repair issues but do not make an otherwise usable MCP client unusable.

- [ ] **Step 4: Write rendered Overview tests**

In `overview.test.tsx`, render the real `Overview` with store fixtures and assert:

- the formula exposes the accessible text `Session plus service plus clients equals ready`;
- visual terms show `SESSION`, `SERVICE`, `CLIENTS`, and `READY`;
- a blocked browser state renders exactly one primary button `Configure browser`;
- stdio renders `Direct stdio`, not `Daemon stopped`;
- ready state renders no primary next-action button;
- client counts and repair issues are visible without duplicate metric cards;
- an issue button changes to Setup and focuses `local-service-heading`;
- the old `Capabilities`, `Quick actions`, and duplicate IDE status headings are absent.

- [ ] **Step 5: Implement the signature and Overview composition**

`ReadinessFormula` renders text operators as real text and uses `data-state` for styling. Include a visually hidden full sentence so screen readers do not hear punctuation without meaning.

`NextAction` renders at most one `ActionButton`. It maps `open-tab` to the app navigation callback and maps declared `dispatchType` values to existing store actions.

`Overview.tsx` becomes only:

```tsx
export function Overview({ navigate }: OverviewProps) {
  const state = useStore();
  const readiness = selectReadiness(state);

  return (
    <div className="tab-stack" aria-labelledby="overview-heading">
      <OverviewHero readiness={readiness} navigate={navigate} />
      <StatusSummary readiness={readiness} navigate={navigate} />
      <OverviewClients
        statuses={state.ideStatuses}
        navigate={navigate}
      />
      <OverviewLinks navigate={navigate} />
    </div>
  );
}
```

The actual implementation must select only state fields needed by each component rather than subscribing to actions and transient maps through a whole-store selector.

Add an app navigation function:

```ts
function navigate(tab: DashboardTabId, focusTargetId?: string): void {
  setTab(tab);
  if (!focusTargetId) return;
  requestAnimationFrame(() => {
    document.getElementById(focusTargetId)?.focus();
  });
}
```

Every cross-tab focus target is a heading with `tabIndex={-1}`.

- [ ] **Step 6: Style the formula without turning the page into a brand poster**

Add `readiness.css`. Use restrained accent borders or term markers. At `max-width: 320px`, allow terms/operators to wrap as a readable two-line expression. Do not shrink the text below 11px and do not animate state transitions.

- [ ] **Step 7: Verify selector, rendering, and build**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/readiness.test.ts src/test/overview.test.tsx
pnpm --filter @airtable-formula/webview test
pnpm --filter @airtable-formula/webview build
```

Expected green result: every priority branch is deterministic, stdio is represented correctly, Overview exposes one next step, and the readiness formula is the dominant but restrained signature.

- [ ] **Step 8: Commit the readiness-first Overview**

```powershell
git status --short
git add packages/webview/src/selectors/readiness.ts packages/webview/src/components/ReadinessFormula.tsx packages/webview/src/components/NextAction.tsx packages/webview/src/components/StatusSummary.tsx packages/webview/src/tabs/overview/OverviewHero.tsx packages/webview/src/tabs/overview/OverviewClients.tsx packages/webview/src/tabs/overview/OverviewLinks.tsx packages/webview/src/tabs/Overview.tsx packages/webview/src/App.tsx packages/webview/src/styles/readiness.css packages/webview/src/styles.css packages/webview/src/test/readiness.test.ts packages/webview/src/test/overview.test.tsx
git commit -m "feat(webview): make Overview readiness first"
```

---

### Task 7: Decompose Setup into local service and editor workbench sections

**Files:**

- Create: `packages/webview/src/tabs/setup/snippets.ts`
- Create: `packages/webview/src/tabs/setup/LocalServiceSection.tsx`
- Create: `packages/webview/src/tabs/setup/EditorsSection.tsx`
- Create: `packages/webview/src/components/EditorCard.tsx`
- Modify: `packages/webview/src/components/IdeCard.tsx`
- Modify: `packages/webview/src/components/Pill.tsx`
- Modify: `packages/webview/src/components/StatusDot.tsx`
- Modify: `packages/webview/src/tabs/Setup.tsx`
- Create: `packages/webview/src/styles/editor.css`
- Modify: `packages/webview/src/styles.css`
- Modify: `packages/webview/src/test/setup.test.tsx`
- Create: `packages/webview/src/test/setup-service-editors.test.tsx`

**Interfaces:**

- Consumes: daemon state, `mcp.useDaemon`, IDE statuses, pending daemon/IDE action maps, setup/unconfigure actions, and snippet input data.
- Produces: a thin Setup composer, mode-aware local-service controls, accessible editor cards, host-routed docs actions, and snippet helpers isolated from rendering.

- [ ] **Step 1: Retarget pure snippet tests and add real section tests**

Move `formatUptime`, `getMcpSnippet`, `getLspSnippet`, and `getOfficialAirtableSnippet` into `tabs/setup/snippets.ts`. Change existing helper tests to import from that file before moving implementation; observe the import failure.

Create `setup-service-editors.test.tsx` and assert:

```tsx
it('does not render daemon lifecycle controls in direct stdio mode', () => {
  useStore.setState(makeDashboardState({
    settings: { mcp: { useDaemon: false } },
    daemon: undefined,
  }));

  render(<Setup />);

  expect(screen.getByRole('heading', { name: 'Local service' })).toBeVisible();
  expect(screen.getByText('Direct stdio mode')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Start service' })).not.toBeInTheDocument();
});

it('disables only daemon controls during a daemon action', () => {
  useStore.setState({
    ...makeDashboardState(),
    pendingDaemonActions: new Set(['abc123']),
    pendingActions: new Set(['abc123']),
  });

  render(<Setup />);

  expect(screen.getByRole('button', { name: 'Restart service' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Update Cursor' })).toBeEnabled();
});
```

Also test:

- healthy/running service status uses `role="status"`;
- unhealthy service details use `role="alert"`;
- detected editors come before undetected editors;
- `Setup all detected editors` is available;
- an undetected editor's Docs action calls `openIdeDocs(ideId)`;
- partial MCP/LSP/AI states have literal accessible text, not color-only meaning;
- `mcpServerHealthy === false` exposes `Server path missing`.

- [ ] **Step 2: Run focused tests and observe red**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/setup.test.tsx src/test/setup-service-editors.test.tsx
```

Expected red result: helper imports fail, Setup is monolithic, stdio is conflated with daemon state, and editor actions still use direct links and inline style.

- [ ] **Step 3: Move pure snippet helpers without behavior changes**

Move the four named helpers verbatim, export their parameter/result types, update Setup imports, and rerun only `setup.test.tsx`. This intermediate green proves the move did not alter generated configuration.

- [ ] **Step 4: Implement `LocalServiceSection`**

Use the heading:

```tsx
<h2 id="local-service-heading" tabIndex={-1}>Local service</h2>
```

When `useDaemon` is false, show `Direct stdio mode` and explain that each client owns its own process. Do not show stopped/error daemon language.

When daemon mode is enabled:

- show running/healthy/starting/stopped with text plus status icon;
- show ports and uptime only when present;
- offer Start when stopped, Stop and Restart when running;
- disable only buttons whose resource is in `pendingDaemonActions`;
- retain bearer token copy/rotation, with the existing host-side protections;
- use `aria-busy` on the service section during lifecycle actions.

- [ ] **Step 5: Implement `EditorCard` and the Editors section**

Replace the old inline-heavy card with semantic rows and classes. The card heading is the editor label. Status text must include one of `Ready`, `Needs setup`, `Partial`, or `Not detected`.

Use `button` for Docs and route through `openIdeDocs(status.ideId)`. Keep all existing MCP, LSP, AI-file, version, manual-step, update, and unconfigure behavior.

Retain `IdeCard.tsx` temporarily as:

```ts
export { EditorCard as IdeCard } from './EditorCard.js';
```

This protects existing design-sync preview imports until Task 13 updates them. After the Task 13 previews import `EditorCard` directly, delete `IdeCard.tsx` in that same design-sync commit and remove it from the preview list.

- [ ] **Step 6: Make Setup a composition layer**

At this checkpoint, `Setup.tsx` renders the first two new sections and the existing remote/manual/official content below them. Delete the migrated daemon/editor JSX from the monolith so controls do not appear twice.

- [ ] **Step 7: Verify the first Setup slice**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/setup.test.tsx src/test/setup-service-editors.test.tsx
pnpm --filter @airtable-formula/webview test
pnpm --filter @airtable-formula/webview build
```

Expected green result: snippet outputs are unchanged, service status respects transport mode, editor capabilities remain intact, and unrelated pending actions cannot lock the daemon or editors.

- [ ] **Step 8: Commit the local-service/editor slice**

```powershell
git status --short
git add packages/webview/src/tabs/setup/snippets.ts packages/webview/src/tabs/setup/LocalServiceSection.tsx packages/webview/src/tabs/setup/EditorsSection.tsx packages/webview/src/components/EditorCard.tsx packages/webview/src/components/IdeCard.tsx packages/webview/src/components/Pill.tsx packages/webview/src/components/StatusDot.tsx packages/webview/src/tabs/Setup.tsx packages/webview/src/styles/editor.css packages/webview/src/styles.css packages/webview/src/test/setup.test.tsx packages/webview/src/test/setup-service-editors.test.tsx
git commit -m "refactor(webview): focus Setup on service and editors"
```

---

### Task 8: Complete Setup with progressive remote, manual, and official configuration

**Files:**

- Create: `packages/webview/src/components/Disclosure.tsx`
- Create: `packages/webview/src/components/FormField.tsx`
- Create: `packages/webview/src/components/SnippetCard.tsx`
- Create: `packages/webview/src/components/ProgressField.tsx`
- Create: `packages/webview/src/tabs/setup/RemoteAccessSection.tsx`
- Create: `packages/webview/src/tabs/setup/ManualConfigSection.tsx`
- Create: `packages/webview/src/tabs/setup/OfficialAirtableSection.tsx`
- Modify: `packages/webview/src/tabs/Setup.tsx`
- Create: `packages/webview/src/styles/forms.css`
- Modify: `packages/webview/src/styles.css`
- Create: `packages/webview/src/test/setup-advanced.test.tsx`

**Interfaces:**

- Consumes: tunnel actions/state, browser download state, snippet helpers, official PAT/configuration state, IDE statuses, and existing official Airtable actions.
- Produces: native form controls, semantic progress/status/error feedback, one-snippet-at-a-time manual configuration, and collapsed advanced sections without feature loss.

- [ ] **Step 1: Write failing rendered tests**

Create `setup-advanced.test.tsx`:

```tsx
it('uses a native provider select and announces tunnel failure', async () => {
  const user = userEvent.setup();
  useStore.setState(makeDashboardState({
    tunnel: {
      status: 'error',
      url: null,
      provider: 'ngrok',
      ngrokAuthtokenSet: false,
      autoDisabledReason: null,
    },
  }));

  render(<Setup />);

  await user.click(screen.getByRole('button', { name: 'Remote access' }));
  expect(screen.getByRole('combobox', { name: 'Tunnel provider' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Remote access could not start');
});

it('renders browser download as native progress', () => {
  useStore.setState(makeDashboardState({
    auth: {
      status: 'chrome-missing',
      hasCredentials: false,
      browserDownload: { status: 'downloading', progress: 42 },
    },
  }));

  render(<Setup />);

  expect(screen.getByRole('progressbar', { name: 'Bundled Chromium download' }))
    .toHaveAttribute('value', '42');
});
```

Also assert:

- disclosure buttons expose `aria-expanded` and `aria-controls`;
- manual configuration uses native selects named `Client` and `Protocol`;
- only one code snippet is rendered at a time;
- Copy uses clipboard and announces `Configuration copied`;
- official PAT field has a visible label and never echoes the saved PAT;
- official configure/unconfigure buttons remain per IDE;
- at 320px-oriented markup, field groups have no forced column role/structure.

- [ ] **Step 2: Run the test and observe red**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/setup-advanced.test.tsx
```

Expected red result: remote/manual/official content remains a long monolith, snippet selectors are pseudo-tabs, and progress/status semantics are incomplete.

- [ ] **Step 3: Implement reusable disclosure and form primitives**

`Disclosure` must use a button, `aria-expanded`, and `aria-controls`; it does not use `<details>` because callers need controlled initial state and focus targets.

`FormField` accepts `label`, `description`, `error`, `required`, and `children`. It generates stable IDs with `useId`, associates label/description/error using `htmlFor`, `aria-describedby`, and `aria-invalid`.

`ProgressField` renders:

```tsx
<div className="progress-field">
  <label htmlFor={id}>{label}</label>
  <progress id={id} max={100} value={value}>
    {value}%
  </progress>
  <span aria-hidden="true">{value}%</span>
</div>
```

`SnippetCard` receives plain text, a language label, and an `onCopy` callback. It renders a `<pre><code>` block and a Copy button; no nested tab widget and no inline style.

- [ ] **Step 4: Implement the remaining Setup sections in locked order**

`Setup.tsx` becomes:

```tsx
export function Setup() {
  return (
    <div className="tab-stack" aria-labelledby="setup-heading">
      <h1 id="setup-heading" className="tab-heading">Setup</h1>
      <LocalServiceSection />
      <EditorsSection />
      <RemoteAccessSection />
      <ManualConfigSection />
      <OfficialAirtableSection />
    </div>
  );
}
```

Behavior:

- Local service and Editors remain open.
- Remote access is a disclosure, open when active/error/auto-disabled.
- Manual configuration is collapsed by default and uses two native selects.
- Official Airtable MCP is collapsed by default, open when a PAT/configuration issue exists.
- Remote access requires a healthy daemon and says so before enabling controls.
- Named Cloudflare, quick Cloudflare, and ngrok keep their existing inputs/actions.
- Manual MCP and LSP snippet generation remains byte-for-byte covered by the moved pure tests.

- [ ] **Step 5: Add narrow-width form behavior**

In `forms.css`, stack all form rows below 420px, make action groups wrap, make snippets horizontally scroll within their own container, and keep every button/input/select at least 28px high. Do not hide labels to save space.

- [ ] **Step 6: Verify complete Setup**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/setup.test.tsx src/test/setup-service-editors.test.tsx src/test/setup-advanced.test.tsx
pnpm --filter @airtable-formula/webview test
pnpm --filter @airtable-formula/webview build
node -e "const fs=require('node:fs'),z=require('node:zlib');const kb=z.gzipSync(fs.readFileSync('packages/extension/dist/webview/main.js')).length/1024;console.log('main.js gzip='+kb.toFixed(2)+' KiB');if(kb>90)process.exit(1)"
```

Expected green result: all existing Setup capabilities are present once, advanced content is progressive, status/progress are semantic, and configuration snippets remain unchanged.

- [ ] **Step 7: Commit the completed Setup workbench**

```powershell
git status --short
git add packages/webview/src/components/Disclosure.tsx packages/webview/src/components/FormField.tsx packages/webview/src/components/SnippetCard.tsx packages/webview/src/components/ProgressField.tsx packages/webview/src/tabs/setup/RemoteAccessSection.tsx packages/webview/src/tabs/setup/ManualConfigSection.tsx packages/webview/src/tabs/setup/OfficialAirtableSection.tsx packages/webview/src/tabs/Setup.tsx packages/webview/src/styles/forms.css packages/webview/src/styles.css packages/webview/src/test/setup-advanced.test.tsx
git commit -m "feat(webview): complete progressive Setup workflows"
```

---

### Task 9: Rebuild Prompts as a guarded, accessible editing workflow

**Files:**

- Create: `packages/webview/src/tabs/prompts/validation.ts`
- Create: `packages/webview/src/tabs/prompts/PromptReconnectDisclosure.tsx`
- Create: `packages/webview/src/tabs/prompts/PromptList.tsx`
- Create: `packages/webview/src/tabs/prompts/PromptEditor.tsx`
- Modify: `packages/webview/src/tabs/Prompts.tsx`
- Modify: `packages/webview/src/App.tsx`
- Modify: `packages/webview/src/store.ts`
- Create: `packages/webview/src/styles/prompts.css`
- Modify: `packages/webview/src/styles.css`
- Create: `packages/webview/src/test/prompts.test.tsx`
- Modify: `packages/webview/src/test/app.render.test.tsx`

**Interfaces:**

- Consumes: prompt state/actions, `ActionOutcome`, shared prompt limits, host confirmation bridge, top-tab navigation, and `Feedback`/`FormField`/`Disclosure`.
- Produces: list/editor separation, explicit validation, dirty-exit protection, host-confirmed destructive actions, success/failure announcements, and deterministic focus return.

- [ ] **Step 1: Write the guarded-workflow tests first**

Create `prompts.test.tsx`. Use real `Prompts`, store state, and user-event:

```tsx
it('rejects duplicate argument names and disables Save', async () => {
  const user = userEvent.setup();
  useStore.setState(makeDashboardState({
    prompts: {
      prompts: [{
        name: 'inspect-base',
        description: 'Inspect a base',
        arguments: [
          { name: 'appId', description: 'Base', required: true },
        ],
        template: '{appId}',
        isBuiltin: false,
        isModified: false,
      }],
    },
  }));
  render(<Prompts />);

  await user.click(screen.getByRole('button', { name: /inspect-base/i }));
  await user.click(screen.getByRole('button', { name: 'Add argument' }));
  const names = screen.getAllByRole('textbox', { name: /Argument name/i });
  await user.type(names[1], 'appId');

  expect(screen.getByRole('alert')).toHaveTextContent('Argument names must be unique');
  expect(screen.getByRole('button', { name: 'Save prompt' })).toBeDisabled();
});

it('keeps edits and announces the host error after save fails', async () => {
  const user = userEvent.setup();
  renderPromptEditor();

  const description = screen.getByRole('textbox', { name: 'Description' });
  await user.clear(description);
  await user.type(description, 'Unsaved description');
  await user.click(screen.getByRole('button', { name: 'Save prompt' }));
  const id = lastPostedActionId('action:save-prompt');

  act(() => {
    useStore.getState().markActionDone(id, {
      ok: false,
      error: 'Prompt file is read-only',
    });
  });

  expect(description).toHaveValue('Unsaved description');
  expect(screen.getByRole('alert')).toHaveTextContent('Prompt file is read-only');
});
```

Add tests for:

- reconnect guidance is collapsed by default and uses `aria-expanded`;
- every input/textarea has a visible associated label;
- prompt names obey lowercase-letter/digit/hyphen rules and 64-character max;
- arg names obey the shared arg pattern, maximum 16, and exact-case uniqueness;
- save pending exposes `role="status"` and `aria-busy`;
- save success returns to the list and focuses the edited prompt row;
- new-prompt success/cancel returns focus to `New prompt`;
- delete cancellation stays in the editor and announces `Delete cancelled`;
- reset cancellation stays in the editor and announces `Reset cancelled`;
- deleting/resetting sends the action directly and relies on the host modal rather than `window.confirm`;
- unsaved Back requests `discard-prompt-edits`;
- a negative confirmation keeps the editor and focus;
- a positive confirmation exits;
- argument rows carry the responsive class `prompt-argument`.

Extend `app.render.test.tsx`:

1. open Prompts;
2. open an editor and make it dirty;
3. click Settings;
4. dispatch a negative `confirmation:result` and assert Prompts remains selected;
5. repeat and dispatch a positive result;
6. assert Settings becomes selected without forcing focus away from the selected Settings tab.

- [ ] **Step 2: Run the focused tests and observe red**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/prompts.test.tsx src/test/app.render.test.tsx
```

Expected red result: the old editor has incomplete arg validation, no host dirty-exit request, generic failure copy, and incomplete focus restoration.

- [ ] **Step 3: Centralize prompt-draft validation**

In Task 2, the shared contract exports `PROMPT_NAME_PATTERN`, `PROMPT_ARG_NAME_PATTERN`, `MAX_PROMPT_ARGUMENTS`, and `MAX_PROMPT_TEMPLATE_LENGTH`. Use those exact exports here.

Create:

```ts
export interface PromptDraftErrors {
  name?: string;
  template?: string;
  arguments: Record<number, string>;
  form?: string;
}

export function validatePromptDraft(prompt: PromptDef): PromptDraftErrors {
  const errors: PromptDraftErrors = { arguments: {} };
  if (!PROMPT_NAME_PATTERN.test(prompt.name)) {
    errors.name = 'Use lowercase letters, digits, and hyphens; start with a letter.';
  }
  if (prompt.template.length > MAX_PROMPT_TEMPLATE_LENGTH) {
    errors.template = 'Template must be 16,384 characters or fewer.';
  }
  if (prompt.arguments.length > MAX_PROMPT_ARGUMENTS) {
    errors.form = 'A prompt can have at most 16 arguments.';
  }

  const seen = new Set<string>();
  prompt.arguments.forEach((argument, index) => {
    if (!PROMPT_ARG_NAME_PATTERN.test(argument.name)) {
      errors.arguments[index] = 'Start with a letter; then use letters, digits, underscores, or hyphens.';
    } else if (seen.has(argument.name)) {
      errors.arguments[index] = 'Argument names must be unique.';
    }
    seen.add(argument.name);
  });
  return errors;
}
```

Do not invent different limits from the host parser.

- [ ] **Step 4: Split list, editor, and reconnect guidance**

`Prompts.tsx` owns only:

- selected prompt/new-prompt state;
- the element ID that should regain focus;
- switching between `PromptList` and `PromptEditor`.

`PromptReconnectDisclosure` uses the shared `Disclosure` and is collapsed by default.

`PromptList` renders one heading, prompt rows, built-in/modified text, and `New prompt`.

`PromptEditor`:

- uses `FormField` for name, description, every argument name/description, and template;
- gives argument labels unique visible text such as `Argument name 1`;
- derives `dirty` from the current draft versus the initial draft rather than only setting a one-way boolean;
- tracks only its own in-flight action ID;
- reads the full `ActionOutcome`;
- shows pending/success as `role="status"` and failure as `role="alert"`;
- never clears input after failure;
- treats `cancelled` separately from an operational error.

- [ ] **Step 5: Add one shared dirty-navigation gate**

Add to the store:

```ts
promptEditorDirty: boolean;
setPromptEditorDirty: (dirty: boolean) => void;
guardPromptNavigation: (navigate: () => void) => Promise<boolean>;
```

Implement:

```ts
guardPromptNavigation: async navigate => {
  if (!get().promptEditorDirty) {
    navigate();
    return true;
  }

  const confirmed = await requestHostConfirmation('discard-prompt-edits');
  if (!confirmed) return false;

  set({ promptEditorDirty: false });
  navigate();
  return true;
},
```

Use this same method for Prompt Back and top-level tab changes. `DashboardTabs` remains presentation-only; App supplies a guarded `onRequestSelect`.

The exact App bridge is:

```tsx
<DashboardTabs
  tabs={TABS}
  activeTab={activeTab}
  onRequestSelect={tab =>
    guardPromptNavigation(() => {
      setTab(tab);
    })
  }
/>
```

Because `DashboardTabs` waits for the returned boolean, rejected navigation returns focus to the currently selected tab instead of focusing an unselected destination.

- [ ] **Step 6: Restore focus intentionally**

Give each prompt row `id={`prompt-row-${prompt.name}`}` and New prompt `id="new-prompt-button"`. After leaving the editor:

```ts
requestAnimationFrame(() => {
  document.getElementById(returnFocusId)?.focus();
});
```

After a rejected dirty-navigation confirmation, refocus the control that initiated navigation.

- [ ] **Step 7: Add narrow argument layout**

In `prompts.css`, use a two-column argument layout only when space permits. At `max-width: 420px`, `.prompt-argument` is a single-column stack with Remove below the fields. All error text remains adjacent to its field.

- [ ] **Step 8: Verify the complete prompt workflow**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/prompts.test.tsx src/test/app.render.test.tsx
pnpm --filter @airtable-formula/webview test
pnpm --filter @airtable-formula/webview build
```

Expected green result: unsaved work is never silently discarded, invalid/duplicate args cannot be submitted, failures retain input, destructive confirmation is native to VS Code, and focus returns predictably.

- [ ] **Step 9: Commit the prompt workflow**

```powershell
git status --short
git add packages/webview/src/tabs/prompts/validation.ts packages/webview/src/tabs/prompts/PromptReconnectDisclosure.tsx packages/webview/src/tabs/prompts/PromptList.tsx packages/webview/src/tabs/prompts/PromptEditor.tsx packages/webview/src/tabs/Prompts.tsx packages/webview/src/App.tsx packages/webview/src/store.ts packages/webview/src/styles/prompts.css packages/webview/src/styles.css packages/webview/src/test/prompts.test.tsx packages/webview/src/test/app.render.test.tsx
git commit -m "feat(webview): guard and clarify prompt editing"
```

---

### Task 10: Rebuild Settings account, browser, storage, and action feedback

**Files:**

- Create: `packages/webview/src/lib/useActionOutcome.ts`
- Create: `packages/webview/src/components/SettingRow.tsx`
- Create: `packages/webview/src/tabs/settings/AccountSection.tsx`
- Create: `packages/webview/src/tabs/settings/BrowserSection.tsx`
- Create: `packages/webview/src/tabs/settings/StorageSection.tsx`
- Modify: `packages/webview/src/tabs/Settings.tsx`
- Create: `packages/webview/src/styles/settings.css`
- Modify: `packages/webview/src/styles.css`
- Create: `packages/webview/src/test/settings-account-storage.test.tsx`

**Interfaces:**

- Consumes: auth state/actions, safe browser summaries, safe setting changes, opaque storage IDs, backup/restore actions, and action outcomes.
- Produces: explicit account/browser/storage groups, per-control pending feedback, safe browser selection, and no raw-path action.

- [ ] **Step 1: Write focused account/browser/storage tests**

Create `settings-account-storage.test.tsx`:

```tsx
it('offers auto and detected browser ids while custom path stays host-owned', async () => {
  const user = userEvent.setup();
  useStore.setState(makeDashboardState({
    auth: {
      status: 'valid',
      hasCredentials: true,
      availableBrowsers: [
        { id: 'chrome', found: true, channel: 'chrome', label: 'Google Chrome' },
        { id: 'edge', found: true, channel: 'msedge', label: 'Microsoft Edge' },
      ],
    },
  }));

  render(<Settings />);

  const browser = screen.getByRole('combobox', { name: 'Browser selection' });
  expect(within(browser).getByRole('option', { name: 'Automatic' })).toHaveValue('auto');
  expect(within(browser).getByRole('option', { name: 'Google Chrome' })).toHaveValue('chrome');
  expect(within(browser).getByRole('option', { name: 'Microsoft Edge' })).toHaveValue('edge');
  expect(within(browser).queryByRole('option', { name: /custom path/i })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Choose custom browser executable' }));
  expect(lastPostedMessage()).toMatchObject({
    type: 'action:selectCustomBrowser',
  });
});

it('opens a storage entry by id and never posts its path', async () => {
  const user = userEvent.setup();
  useStore.setState(makeDashboardState({
    storage: {
      entries: [{
        id: 'tool-config',
        label: 'Tool Config',
        exists: true,
      }],
    },
  }));

  render(<Settings />);
  await user.click(screen.getByRole('button', { name: 'Open Tool Config' }));

  expect(lastPostedMessage()).toMatchObject({
    type: 'action:openStoragePath',
    entryId: 'tool-config',
  });
  expect(lastPostedMessage()).not.toHaveProperty('path');
});
```

Also test:

- account status and primary login/logout action remain open;
- browser missing/error is `role="alert"`;
- browser choice posts `{ mode: 'detected', browserId }`;
- custom selection is a separate button;
- credential, cookie, login mode, and auth mode flows remain available;
- a valid non-preset refresh interval such as 7 hours remains selected and writable;
- secrets clear only after a confirmed state/result, not on submit failure;
- backup and restore remain available and describe replacement risk;
- changing one setting disables only that row;
- action result success uses `role="status"`;
- action result failure uses `role="alert"` with host error text;
- storage entries expose only ID, label, existence, and size; no raw path is rendered or present in state.

- [ ] **Step 2: Run the focused test and observe red**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/settings-account-storage.test.tsx
```

Expected red result: Settings still uses one global pending flag, host-shaped browser choices, raw storage paths, and dense mixed account/browser/storage JSX.

- [ ] **Step 3: Add a per-action outcome hook**

Create:

```ts
import { useEffect, useState } from 'react';
import type { ActionOutcome } from '../store.js';
import { useStore } from '../store.js';

export function useActionOutcome(actionId: string | null) {
  const pending = useStore(state =>
    actionId === null ? false : state.pendingActions.has(actionId),
  );
  const consumeActionResult = useStore(state => state.consumeActionResult);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  useEffect(() => {
    if (actionId === null || pending) return;
    const result = consumeActionResult(actionId);
    if (result) setOutcome(result);
  }, [actionId, consumeActionResult, pending]);

  return { pending, outcome, clearOutcome: () => setOutcome(null) };
}
```

Export `ActionOutcome` from a stable module or from `store.ts`; do not duplicate the shape.

- [ ] **Step 4: Implement `SettingRow` and the first three groups**

`SettingRow` takes a heading/label, optional description, control, and optional feedback. It uses semantic text and a flexible grid that stacks below 420px.

`AccountSection` retains auth mode, manual/automatic login, direct-login credentials, BYO cookie, session status/check/login/logout, auto-refresh, and refresh interval. Auth-mode copy says that changing it restarts/reprovisions the active transport before the row reports success.

The refresh UI may offer 1/4/8/12/24/48/168-hour presets, but when the current validated value is another integer in 1–168 it must add a `7 hours (current)`-style option rather than render a blank select or coerce the setting.

`BrowserSection`:

- maps `auto` to `{ mode: 'auto' }`;
- maps a stable option to `{ mode: 'detected', browserId }`;
- invokes `selectCustomBrowser()` only from a separate button;
- routes Chrome help through `openLink('chrome')`;
- keeps bundled Chromium install/remove/progress behavior;
- never reads or posts an executable path.

`StorageSection` renders label, existence, and optional size, then calls `openStoragePath(entry.id)`. Keep backup and restore, naming that restore replaces current session data. No raw path is present in the webview snapshot.

- [ ] **Step 5: Replace global pending with local action IDs**

Remove `settingsPending`. Each setting or action stores its returned action ID locally and uses `useActionOutcome`. A slow browser picker may disable its button, but must not disable auth, storage, or other setting rows.

- [ ] **Step 6: Verify the first Settings slice**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/settings-account-storage.test.tsx
pnpm --filter @airtable-formula/webview test
pnpm --filter @airtable-formula/webview build
```

Expected green result: account/browser/storage behaviors are preserved, boundary-safe payloads are used, and feedback is local to the action that owns it.

- [ ] **Step 7: Commit the account/browser/storage slice**

```powershell
git status --short
git add packages/webview/src/lib/useActionOutcome.ts packages/webview/src/components/SettingRow.tsx packages/webview/src/tabs/settings/AccountSection.tsx packages/webview/src/tabs/settings/BrowserSection.tsx packages/webview/src/tabs/settings/StorageSection.tsx packages/webview/src/tabs/Settings.tsx packages/webview/src/styles/settings.css packages/webview/src/styles.css packages/webview/src/test/settings-account-storage.test.tsx
git commit -m "refactor(webview): make account and storage settings explicit"
```

---

### Task 11: Complete Settings information architecture and move runtime controls to the right place

**Files:**

- Create: `packages/webview/src/tabs/settings/ToolSafetySection.tsx`
- Create: `packages/webview/src/tabs/settings/FormulaScriptingSection.tsx`
- Create: `packages/webview/src/tabs/settings/DiagnosticsSection.tsx`
- Create: `packages/webview/src/tabs/settings/AdvancedRuntimeSection.tsx`
- Modify: `packages/webview/src/tabs/settings/SupportAboutSection.tsx`
- Modify: `packages/webview/src/tabs/Settings.tsx`
- Modify: `packages/webview/src/App.tsx`
- Modify: `packages/webview/src/styles/settings.css`
- Create: `packages/webview/src/test/settings-groups.test.tsx`

**Interfaces:**

- Consumes: tool profile/category settings, AI-file settings, formula/script settings, debug actions/state, advanced transport settings, support links, versions, and cross-tab navigation.
- Produces: eight locked Settings groups, collapsed diagnostics/advanced runtime, explicit restart impact, and no daemon lifecycle duplication.

- [ ] **Step 1: Write group and feature-preservation tests**

Create `settings-groups.test.tsx` and assert these headings in order:

1. `Account and authentication`
2. `Browser`
3. `Tool safety`
4. `Formula and scripting`
5. `Storage and session backup`
6. `Diagnostics`
7. `Advanced runtime`
8. `Support and About`

Add literal tests:

```tsx
it('keeps diagnostics and advanced runtime collapsed by default', () => {
  render(<Settings navigate={vi.fn()} />);

  expect(screen.getByRole('button', { name: 'Diagnostics' }))
    .toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Advanced runtime' }))
    .toHaveAttribute('aria-expanded', 'false');
});

it('keeps daemon lifecycle out of Settings and links to Setup', async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(<Settings navigate={navigate} />);

  expect(screen.queryByRole('button', { name: 'Start service' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop service' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Manage local service in Setup' }));
  expect(navigate).toHaveBeenCalledWith('setup', 'local-service-heading');
});
```

Also test:

- profiles `read-only`, `safe-write`, `full`, and `custom`;
- all 15 current tool-category toggles remain under custom;
- category messages use `{ key: 'mcp.category', category, value }`;
- AI auto-install/include-agent settings remain;
- formatter v1/v2, five beautify styles, and four minify levels remain;
- debug enable, verbose HTTP, buffer size, start/stop/export remain;
- valid non-preset `browserIdleParkMinutes` and `debug.bufferSize` values remain representable rather than being silently coerced;
- `Open tool-config.json` posts `action:openToolConfig`;
- `Start Session` posts `action:debug.startSession`;
- `Stop & Export` posts `action:debug.stopAndExport`;
- `Export Full Log` posts `action:debug.export`;
- debug and advanced disclosures preserve focus when toggled;
- server source, daemon port, browser idle park, and HTTP client explain restart impact before their controls;
- current daemon/stdio mode is visible but read-only; no `mcp.useDaemon` write leaves the webview;
- Support/About renders extension and bundled MCP versions plus four opaque link actions.

- [ ] **Step 2: Run focused tests and observe red**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/settings-groups.test.tsx
```

Expected red result: the old monolith still owns the remaining groups, diagnostics is open, advanced runtime is not coherent, and daemon controls are duplicated.

- [ ] **Step 3: Implement Tool Safety**

Move tool profile and category controls into `ToolSafetySection`. Preserve counts and danger descriptions. Use `SettingRow`; avoid generic “danger” color without text. The Sync category description must retain that `apply` can mutate and delete under mirror policy.

- [ ] **Step 4: Implement Formula and Scripting**

Move:

- AI file auto-install and agent-file inclusion;
- formula formatter v1/v2;
- script beautify style;
- script minify level.

Use native selects with visible labels and local action feedback.

- [ ] **Step 5: Implement collapsed Diagnostics**

The disclosure summary shows recording/idle and event count without opening it. Inside, retain debug enable, verbose HTTP, buffer size, start session, stop/export, and export. Use `role="status"` for recording state and never style normal diagnostics as a product error.

- [ ] **Step 6: Implement collapsed Advanced Runtime**

Include:

- read-only current mode derived from `mcp.useDaemon`, with the reload-required copy defined in Task 3;
- `mcp.serverSource`;
- `mcp.daemonPort`;
- `mcp.browserIdleParkMinutes`;
- `mcp.httpClient`;
- `mcp.autoConfigureOnInstall`;
- `mcp.notifyOnUpdates`.

Place text `Takes effect after the local service restarts` before controls that require restart. Add `Manage local service in Setup`, using `navigate('setup', 'local-service-heading')`. Do not render Start, Stop, Restart, bearer-token, or tunnel buttons in Settings.

Use bounded numeric inputs for browser idle park and debug buffer, or add the current validated value to a preset select. The UI and shared parser must accept all integers in their declared ranges, not only the suggested presets.

- [ ] **Step 7: Make Settings a thin ordered composition**

`Settings.tsx` becomes:

```tsx
export function Settings({ navigate }: SettingsProps) {
  return (
    <div className="tab-stack" aria-labelledby="settings-heading">
      <h1 id="settings-heading" className="tab-heading">Settings</h1>
      <AccountSection />
      <BrowserSection />
      <ToolSafetySection />
      <FormulaScriptingSection />
      <StorageSection />
      <DiagnosticsSection />
      <AdvancedRuntimeSection navigate={navigate} />
      <SupportAboutSection />
    </div>
  );
}
```

- [ ] **Step 8: Verify complete Settings**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/settings-account-storage.test.tsx src/test/settings-groups.test.tsx src/test/support-about.test.tsx
pnpm --filter @airtable-formula/webview test
pnpm --filter @airtable-formula/webview build
node -e "const fs=require('node:fs'),z=require('node:zlib');const kb=z.gzipSync(fs.readFileSync('packages/extension/dist/webview/main.js')).length/1024;console.log('main.js gzip='+kb.toFixed(2)+' KiB');if(kb>90)process.exit(1)"
```

Expected green result: all current settings capabilities remain, advanced content is progressive, restart impact is explicit, and lifecycle controls exist only in Setup.

- [ ] **Step 9: Commit the Settings architecture**

```powershell
git status --short
git add packages/webview/src/tabs/settings/ToolSafetySection.tsx packages/webview/src/tabs/settings/FormulaScriptingSection.tsx packages/webview/src/tabs/settings/DiagnosticsSection.tsx packages/webview/src/tabs/settings/AdvancedRuntimeSection.tsx packages/webview/src/tabs/settings/SupportAboutSection.tsx packages/webview/src/tabs/Settings.tsx packages/webview/src/App.tsx packages/webview/src/styles/settings.css packages/webview/src/test/settings-groups.test.tsx
git commit -m "feat(webview): complete progressive Settings groups"
```

---

### Task 12: Eliminate inline presentation, enforce strict CSP, and add accessibility regression gates

**Files:**

- Modify: `packages/webview/src/App.tsx`
- Modify: `packages/webview/src/components/AirtableLogo.tsx`
- Modify: `packages/webview/src/components/IdeIcon.tsx`
- Modify: `packages/webview/src/components/Pill.tsx`
- Modify: `packages/webview/src/components/StatusDot.tsx`
- Delete: `packages/webview/src/components/StatCard.tsx`
- Delete: `packages/webview/src/styles/legacy.css`
- Modify: `packages/webview/src/assets/icons/amp.svg`
- Modify: `packages/webview/src/assets/icons/claude-code.svg`
- Modify: `packages/webview/src/assets/icons/claude.svg`
- Modify: `packages/webview/src/assets/icons/cline.svg`
- Modify: `packages/webview/src/assets/icons/cursor.svg`
- Modify: `packages/webview/src/assets/icons/mcp.svg`
- Modify: `packages/webview/src/assets/icons/windsurf.svg`
- Modify: `packages/webview/src/styles.css`
- Modify: `packages/webview/src/styles/tokens.css`
- Modify: `packages/webview/src/styles/base.css`
- Modify: `packages/webview/src/styles/app-shell.css`
- Modify: `packages/webview/src/styles/sections.css`
- Modify: `packages/webview/src/styles/accessibility.css`
- Modify: `packages/webview/src/styles/readiness.css`
- Modify: `packages/webview/src/styles/editor.css`
- Modify: `packages/webview/src/styles/forms.css`
- Modify: `packages/webview/src/styles/prompts.css`
- Modify: `packages/webview/src/styles/settings.css`
- Modify: `packages/extension/src/webview/html.ts`
- Create: `packages/extension/src/test/webview-html.test.ts`
- Create: `packages/webview/src/test/accessibility.test.tsx`
- Create: `packages/webview/src/test/no-inline-style.test.tsx`

**Interfaces:**

- Consumes: every completed tab state, semantic CSS classes, VS Code `webview.cspSource`, and local static SVG assets.
- Produces: no rendered inline styles, strict resource-only CSS, cryptographic script nonce, serious/critical axe gates, and a CSP unit contract.

- [ ] **Step 1: Add rendered no-inline and axe tests**

Create `no-inline-style.test.tsx`:

```tsx
it.each(['overview', 'setup', 'prompts', 'settings'] as const)(
  '%s renders no inline style attributes',
  activeTab => {
    useStore.setState({
      ...makeDashboardState(),
      activeTab,
      loading: false,
    });
    const { container } = render(<App />);

    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  },
);
```

Create `accessibility.test.tsx`:

```tsx
import * as axe from 'axe-core';

async function expectNoSeriousOrCriticalViolations(container: HTMLElement) {
  const result = await axe.run(container, {
    resultTypes: ['violations'],
  });
  const blockers = result.violations.filter(violation =>
    violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blockers).toEqual([]);
}

it('has no serious or critical violations in ready Overview', async () => {
  useStore.setState({
    ...makeDashboardState(),
    activeTab: 'overview',
    loading: false,
  });
  const { container } = render(<App />);
  await expectNoSeriousOrCriticalViolations(container);
});
```

Add axe cases for:

- blocked Overview;
- Setup with tunnel/service error;
- Prompt list;
- open new Prompt editor;
- Settings with Diagnostics and Advanced runtime expanded.

The test must use real components and literal state fixtures. Do not disable axe rules to make it pass; fix the markup.

- [ ] **Step 2: Add CSP tests before changing HTML**

Create `webview-html.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildWebviewCsp, createNonce } from '../webview/html.js';

describe('webview CSP', () => {
  it('uses resource-only styles and nonce-only scripts', () => {
    const csp = buildWebviewCsp(
      { cspSource: 'vscode-webview://test' } as never,
      'nonce-value',
    );

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("img-src vscode-webview://test data:");
    expect(csp).toContain('font-src vscode-webview://test');
    expect(csp).toContain('style-src vscode-webview://test');
    expect(csp).toContain("script-src 'nonce-nonce-value'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it('creates a different cryptographic nonce for each document', () => {
    const first = createNonce();
    const second = createNonce();

    expect(first).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(second).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(second).not.toBe(first);
  });
});
```

- [ ] **Step 3: Run the gates and observe red**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/no-inline-style.test.tsx src/test/accessibility.test.tsx
pnpm --filter airtable-formula exec vitest run src/test/webview-html.test.ts
```

Expected red result: existing JSX/raw SVGs emit style attributes, some complete states expose accessibility violations, and CSP still contains `unsafe-inline` with a non-cryptographic nonce.

- [ ] **Step 4: Remove all remaining inline presentation**

For each remaining component:

- replace static styles with BEM-like classes;
- replace state-dependent styles with `data-state`, `data-variant`, or conditional class names;
- use native `<progress>` for numeric progress;
- use CSS custom properties only when they come from a finite class mapping, not JSX style;
- ensure Lucide icons inherit `currentColor` from a class;
- keep visible text for every status.

Remove the `style="flex:none;line-height:1"` attribute from the seven listed SVG source files. Keep `IdeIcon`'s bundled static `dangerouslySetInnerHTML` only after confirming all raw assets contain no script, event-handler, foreignObject, external reference, or inline style. Add `aria-hidden="true"` to decorative icon wrappers.

Delete `StatCard.tsx`, `.orb*`, `.glass-panel`, metric-card rules, loader keyframes, logo breathing, and bouncing-dot rules once no import/reference remains.

- [ ] **Step 5: Build strict HTML and nonce**

In `html.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type * as vscode from 'vscode';

export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

export function buildWebviewCsp(
  webview: Pick<vscode.Webview, 'cspSource'>,
  nonce: string,
): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "connect-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "form-action 'none'",
  ].join('; ');
}
```

Use the returned CSP in the meta tag. The one external boot `<script>` receives the nonce. No executable inline script and no style attribute remains.

- [ ] **Step 6: Close semantic and responsive gaps found by axe**

Fix the markup, not the test:

- one `h1` per visible tab;
- section headings descend coherently;
- every `tabpanel` points to its selected tab;
- every form field has an associated visible label;
- all feedback has `role="status"` or `role="alert"` based on urgency;
- no duplicate IDs;
- no nested interactive elements;
- no unnamed icon button;
- no color-only status;
- no disabled control without adjacent reason where the reason is not obvious.

In CSS, verify:

- `.vscode-light`, `.vscode-dark`, `.vscode-high-contrast`, and `.vscode-high-contrast-light` inherit semantic tokens;
- all layouts fit 240px without page-level horizontal scrolling;
- controls and action groups wrap at 320px;
- prompt args stack below 420px;
- `prefers-reduced-motion: reduce` suppresses nonessential motion;
- `forced-colors: active` retains borders/focus.

- [ ] **Step 7: Run automated security/accessibility/build gates**

```powershell
pnpm --filter @airtable-formula/webview exec vitest run src/test/no-inline-style.test.tsx src/test/accessibility.test.tsx
pnpm --filter airtable-formula exec vitest run src/test/webview-html.test.ts
pnpm --filter @airtable-formula/webview test
pnpm --filter airtable-formula test
pnpm --filter @airtable-formula/webview build
pnpm --filter airtable-formula build
rg -n "style=|style\\s*\\{\\{" packages/webview/src --glob "*.tsx" --glob "*.svg"
rg -n "unsafe-inline|Math\\.random" packages/extension/src/webview packages/webview/src
```

Expected green result:

- all focused and package tests pass;
- both builds pass;
- source scans return no inline-style, `unsafe-inline`, or nonce `Math.random` hits;
- axe reports no serious/critical violations in required states.

- [ ] **Step 8: Commit CSP and accessibility gates**

The no-inline rendered test and source scan must already be clean after the explicitly listed component, asset, CSS, and CSP edits. If either scan names a file created in Tasks 5–11, treat that as a defect in the owning task: add that exact path to this task's commit and record it in the verification report. Confirm the two unrelated MCP sync files remain untouched.

```powershell
git status --short
git add packages/webview/src/App.tsx packages/webview/src/components/AirtableLogo.tsx packages/webview/src/components/IdeIcon.tsx packages/webview/src/components/Pill.tsx packages/webview/src/components/StatusDot.tsx packages/webview/src/components/StatCard.tsx packages/webview/src/assets/icons/amp.svg packages/webview/src/assets/icons/claude-code.svg packages/webview/src/assets/icons/claude.svg packages/webview/src/assets/icons/cline.svg packages/webview/src/assets/icons/cursor.svg packages/webview/src/assets/icons/mcp.svg packages/webview/src/assets/icons/windsurf.svg packages/webview/src/styles.css packages/webview/src/styles/tokens.css packages/webview/src/styles/base.css packages/webview/src/styles/app-shell.css packages/webview/src/styles/sections.css packages/webview/src/styles/legacy.css packages/webview/src/styles/accessibility.css packages/webview/src/styles/readiness.css packages/webview/src/styles/editor.css packages/webview/src/styles/forms.css packages/webview/src/styles/prompts.css packages/webview/src/styles/settings.css packages/webview/src/test/accessibility.test.tsx packages/webview/src/test/no-inline-style.test.tsx packages/extension/src/webview/html.ts packages/extension/src/test/webview-html.test.ts
git commit -m "feat(webview): enforce strict CSP and accessibility gates"
```

---

### Task 13: Refresh design-sync sources and enforce the bundle budget

**Files:**

- Modify: `.design-sync/conventions.md`
- Modify: `.design-sync/NOTES.md`
- Modify: `.design-sync/ds-src-overlay/_dsPreview.tsx`
- Modify: `.design-sync/previews/App.tsx`
- Modify: `.design-sync/previews/Overview.tsx`
- Modify: `.design-sync/previews/Setup.tsx`
- Modify: `.design-sync/previews/Prompts.tsx`
- Modify: `.design-sync/previews/Settings.tsx`
- Delete: `.design-sync/previews/IdeCard.tsx`
- Create: `.design-sync/previews/ReadinessFormula.tsx`
- Create: `.design-sync/previews/EditorCard.tsx`
- Create: `.design-sync/previews/SettingRow.tsx`
- Delete: `packages/webview/src/components/IdeCard.tsx`

**Interfaces:**

- Consumes: shipped app shell, readiness model, semantic tokens, safe fixture types, and `prep-src.mjs`.
- Produces: design tooling that describes the shipped interface instead of the retired glass system, representative component previews, regenerated mirrors, and a measured bundle result.

- [ ] **Step 1: Prove the design tooling is stale**

Run:

```powershell
rg -n "glass|orb|ambient|inline style|hard-coded dark" .design-sync
node .design-sync/prep-src.mjs
```

Expected pre-change result: conventions/overlays still describe or render the dark glass shell; the generation step may also fail type/build expectations after `SettingsSnapshot` gained `useDaemon`, browser summaries, and storage IDs.

- [ ] **Step 2: Rewrite conventions around the shipped system**

`conventions.md` must document:

- VS Code semantic tokens and the Airtable accent roles;
- the 4/6/8/12/16/20 spacing scale;
- 2/4/6 radii;
- minimum 11px text and 28px controls;
- no inline styles or ambient animation;
- readiness formula hierarchy;
- Section, Disclosure, Feedback, FormField, SnippetCard, EditorCard, SettingRow, and ActionButton usage;
- 240px/320px and reduced-motion/high-contrast expectations.

Remove instructions that recommend glass surfaces, decorative orbs, or inline preview styling.

- [ ] **Step 3: Update the preview fixture and wrappers**

The overlay fixture must satisfy the final `DashboardState` exactly:

- `settings.mcp.useDaemon: true`;
- `settings.mcp.browserIdleParkMinutes: 30`;
- browser IDs and safe browser-choice summary;
- storage entry IDs;
- healthy daemon and valid auth;
- one ready and one partial editor;
- representative prompts, tunnel, official Airtable, diagnostics, and version state.

Use the actual `AppShell` wrapper and shared styles. No preview may add a style prop to fake width/color.

- [ ] **Step 4: Refresh tab and component previews**

Each top-level tab preview must include at least:

- ready and blocked Overview;
- daemon and stdio Setup;
- prompt list and dirty editor;
- default and expanded Settings.

Add standalone previews for readiness state variants, EditorCard states, and SettingRow with pending/success/error feedback.

Update any preview import from `IdeCard` to `EditorCard`, then delete the temporary `packages/webview/src/components/IdeCard.tsx` compatibility re-export.

- [ ] **Step 5: Regenerate rather than hand-edit mirrors**

Run:

```powershell
node .design-sync/prep-src.mjs
```

Inspect the generated output only to confirm it reflects current sources. Do not stage ignored `.ds-src` or `.ds-css` output.

- [ ] **Step 6: Measure the production bundle**

Run:

```powershell
pnpm --filter @airtable-formula/webview build
node -e "const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib');const dir='packages/extension/dist/webview';for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.js')||n.endsWith('.css')).sort()){const data=fs.readFileSync(path.join(dir,name));console.log(name,(data.length/1024).toFixed(2)+' KiB', 'gzip='+ (z.gzipSync(data).length/1024).toFixed(2)+' KiB')}"
```

Acceptance:

- `main.js` is at most 90.00 KiB gzip.
- test-only axe/RTL/jsdom code is absent from production output.
- Motion and Tailwind are absent from the dependency graph:

```powershell
pnpm --filter @airtable-formula/webview why motion tailwindcss @tailwindcss/vite
```

Expected output: no production dependency path.

If JavaScript exceeds 90.00 KiB gzip, inspect and remove dead imports/legacy components before proceeding; do not relax the budget in the plan.

- [ ] **Step 7: Verify design-sync and webview**

```powershell
pnpm --filter @airtable-formula/webview test
pnpm --filter @airtable-formula/webview build
rg -n 'className="[^"]*(glass-panel|orb)|style=|at-logo-breathe|at-dot-bounce' .design-sync/ds-src-overlay .design-sync/previews
```

Expected green result: tests/build pass, the rendered old-system scan returns no hits, conventions explicitly prohibit rather than prescribe the retired patterns, and the bundle meets the cap.

- [ ] **Step 8: Commit only design-sync sources**

```powershell
git status --short
git add -f .design-sync/conventions.md .design-sync/NOTES.md .design-sync/ds-src-overlay/_dsPreview.tsx .design-sync/previews/App.tsx .design-sync/previews/Overview.tsx .design-sync/previews/Setup.tsx .design-sync/previews/Prompts.tsx .design-sync/previews/Settings.tsx .design-sync/previews/ReadinessFormula.tsx .design-sync/previews/EditorCard.tsx .design-sync/previews/SettingRow.tsx
git add -u .design-sync/previews/IdeCard.tsx packages/webview/src/components/IdeCard.tsx
git commit -m "docs(design): sync the native Airtable workbench"
```

---

### Task 14: Refresh vulnerable production resolutions in an isolated dependency commit

**Files:**

- Modify: `packages/mcp-server/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: current MCP server dependency ranges and the production audit.
- Produces: patched compatible resolutions, direct Undici 7.29.0, zero high production advisories, and no feature/source changes.

- [ ] **Step 1: Record the failing security gate**

Run:

```powershell
pnpm audit --prod --audit-level high
pnpm why undici fast-uri hono @modelcontextprotocol/sdk
```

Expected pre-change result:

- audit exits non-zero with 8 high advisories;
- `undici` resolves to 7.24.5;
- `fast-uri` resolves to 3.1.0;
- `hono` resolves to 4.12.12;
- `@modelcontextprotocol/sdk` resolves to 1.29.0.

- [ ] **Step 2: Refresh only the MCP server's compatible dependency graph**

Run:

```powershell
pnpm --filter airtable-user-mcp update @modelcontextprotocol/sdk@1.29.0 cheerio@1.2.0 undici@7.29.0
```

The required advisory floors are:

- direct `@modelcontextprotocol/sdk` remains compatible at 1.29.0 or a newer 1.x release;
- direct/optional `undici >= 7.28.0` and below 8.x in this isolated slice;
- transitive `fast-uri >= 3.1.4`;
- transitive `hono >= 4.12.25`;
- zero high/critical production advisories.

Use the actual safe versions resolved by the current lockfile. Do not fail the task merely because a transitive resolves newer than today's observed `hono 4.12.32`, `ajv 8.20.0`, or `express-rate-limit 8.6.0`.

Do not use `pnpm audit --fix --force`, do not jump Undici to 8.x in this slice, and do not edit any MCP source file.

- [ ] **Step 3: Inspect the exact dependency diff before tests**

```powershell
git diff -- packages/mcp-server/package.json pnpm-lock.yaml
pnpm why undici fast-uri hono ajv express-rate-limit @modelcontextprotocol/sdk
```

If a patched transitive remains stale despite its parent's compatible range, rerun the same scoped update for that package. Do not add a broad workspace override unless a direct compatibility test and a note in the verification report justify it.

- [ ] **Step 4: Run MCP and bundle regression tests**

```powershell
pnpm --filter airtable-user-mcp test
node scripts/bundle-mcp.mjs
pnpm check:bundle-sync
```

Expected green result: all MCP tests pass and the bundled server remains synchronized.

- [ ] **Step 5: Re-run the production security gate**

```powershell
pnpm audit --prod --audit-level high
```

Acceptance: zero high or critical production advisories. Moderate/low findings must be listed in the final verification report with reachability notes; they do not silently disappear from reporting.

- [ ] **Step 6: Commit only dependency metadata**

```powershell
git status --short
git add packages/mcp-server/package.json pnpm-lock.yaml
git commit -m "chore(deps): patch production security advisories"
```

Confirm `packages/mcp-server/src/sync/index.js` and `packages/mcp-server/test/sync/test-index.test.js` remain untouched by the dependency commit.

---

### Task 15: Run full release gates and verify the actual extension experience

**Files:**

- Create: `docs/superpowers/reports/2026-07-26-native-airtable-workbench-verification.md`
- Modify only when a gate reveals a real defect: the owning source/test file from Tasks 1–14

**Interfaces:**

- Consumes: the complete implementation and approved acceptance criteria.
- Produces: a reproducible automated result, real VS Code manual evidence, final score, residual-risk list, and no unsupported 10/10 claim.

- [ ] **Step 1: Run the complete automated chain from the workspace root**

Run each command separately so the failing package is visible:

```powershell
pnpm --filter @airtable-formula/shared test
pnpm --filter @airtable-formula/shared build
pnpm --filter @airtable-formula/webview test
pnpm --filter @airtable-formula/webview build
pnpm --filter airtable-formula test
pnpm test
pnpm build
pnpm audit --prod --audit-level high
node .design-sync/prep-src.mjs
```

Acceptance:

- every command exits 0;
- no generated mirror duplicates are counted as independent webview tests;
- main.js remains at most 90.00 KiB gzip;
- audit has zero high/critical production findings.

If the root suite reveals a failure isolated to either out-of-scope MCP sync file, report the exact evidence before changing that subsystem. All failures caused by this implementation are owned here and must be fixed before continuing.

- [ ] **Step 2: Build and inspect the distributable**

Run:

```powershell
pnpm package
pnpm assert:vsix
```

Expected green result: the VSIX is produced, required native/bundled artifacts are present, and no test-only UI dependency is packaged into the webview.

- [ ] **Step 3: Launch the actual extension host**

From the repository root:

```powershell
code --extensionDevelopmentPath="$PWD\packages\extension" --new-window
```

In the Extension Development Host, run `Airtable Formula: Open Dashboard`.

- [ ] **Step 4: Complete the visual/theme/reflow matrix**

Record Pass/Fail and a short observation for every cell:

| Check | Light | Dark | High Contrast Dark | High Contrast Light |
|---|---:|---:|---:|---:|
| Text/background/borders remain legible |  |  |  |  |
| Readiness accents retain non-color text |  |  |  |  |
| Focus ring is visible on every control |  |  |  |  |
| Native inputs/selects look intentional |  |  |  |  |
| Error/warning/success remain distinguishable |  |  |  |  |

Resize the sidebar to approximately 240px and 320px. Verify:

- no page-level horizontal scrollbar;
- formula wraps coherently;
- tab labels remain reachable;
- prompt args and Settings rows stack;
- snippets scroll only inside the snippet region;
- buttons do not clip or overlap;
- focused controls scroll fully into view.

- [ ] **Step 5: Complete keyboard-only behavior**

Without a pointer:

- Tab reaches the selected top tab once.
- Left/Right wrap; Home/End work; focus activation is automatic.
- Every disclosure toggles with Enter/Space.
- Every action, select, input, snippet copy, editor card, storage action, and support link is reachable.
- Overview jumps focus to the destination section heading.
- Normal top-tab switching keeps focus on the selected tab.
- Dirty prompt Back and tab navigation invoke the VS Code modal; Cancel returns focus; Discard proceeds.
- Save success returns focus to the edited row/New prompt.
- No focus trap, positive `tabIndex`, or invisible focus exists.

- [ ] **Step 6: Complete reduced-motion and live-feedback checks**

Enable reduced motion in the OS and reload the webview. Confirm:

- no breathing logo, bouncing dots, ambient movement, or looping status animation;
- no essential state depends on animation;
- pending/success/failure changes remain understandable.

Trigger representative outcomes:

- login/check status;
- daemon start/restart failure and recovery;
- one IDE setup;
- tunnel failure;
- prompt save success/failure/cancel;
- setting save success/failure;
- browser download progress;
- snippet copy.

Confirm polite updates use status and urgent failures use alert without duplicate announcements.

- [ ] **Step 7: Run NVDA against the real webview**

With NVDA:

- read the app name and aggregate readiness once;
- navigate the four-tab list and hear selected state;
- hear the readiness expression as a meaningful sentence;
- hear issue severity/title/detail and one next action;
- hear labels, descriptions, required/invalid state, and errors for auth, tunnel, prompt, and runtime fields;
- hear progress percentage during browser download;
- hear collapsed/expanded state for every disclosure;
- hear prompt save and setting outcomes;
- confirm decorative icons/SVG titles are not noisy;
- confirm no status is color-only or repeated excessively.

Any NVDA blocker keeps the score below 10/10 and must be fixed with a rendered regression test where practical.

- [ ] **Step 8: Inspect CSP and console health**

Open `Developer: Toggle Developer Tools` in the Extension Development Host. Reload the webview and exercise every tab.

Acceptance:

- no CSP violation;
- no React key/controlled-input warning;
- no uncaught exception;
- no rejected valid host message;
- malicious/legacy messages are rejected only in automated tests, not emitted by current code.

- [ ] **Step 9: Write the verification report**

Create the report with these exact sections:

```md
# Native Airtable Workbench Verification

## Outcome and final score
## Automated gates
## Bundle and dependency audit
## Theme and narrow-width matrix
## Keyboard-only results
## NVDA results
## CSP and console results
## Capability-preservation checklist
## Residual risks
## Evidence and reproduction commands
```

The score policy:

- use `10/10` only when all automated, actual-VS-Code, and NVDA checks pass with no release blocker;
- use a lower score with named deductions for every unverified or failed criterion;
- do not average away a security, keyboard, high-contrast, or data-loss blocker.

- [ ] **Step 10: Commit the verification evidence and any final tested fixes**

For each final defect, create a focused failing regression test, fix it, rerun the owning package plus the full root chain, and commit that defect separately.

Then:

```powershell
git status --short
git add -f docs/superpowers/reports/2026-07-26-native-airtable-workbench-verification.md
git commit -m "docs: verify the native Airtable workbench"
```

---

## Plan Self-Review Checklist

- [ ] Every design-spec goal is owned by at least one task.
- [ ] Every current dashboard capability appears in a preservation test or manual checklist.
- [ ] The security boundary lands before the broader visual migration.
- [ ] Shared types never expose executable paths.
- [ ] Settings writes have a closed key/value union.
- [ ] Raw URLs and filesystem paths never cross from the webview as actions.
- [ ] Every production behavior task starts with a real failing test.
- [ ] Tests render actual components and assert literal behavior; none grep source as a substitute for behavior.
- [ ] Generated mirror paths are excluded from Vitest.
- [ ] No task instructs a worker to edit `.ds-src` or `.ds-css`.
- [ ] No task modifies or reverts the unrelated MCP sync work from `0b444db`.
- [ ] Dependency hardening is isolated from UI commits.
- [ ] Automated completion is explicitly separated from the final NVDA-backed 10/10 claim.
