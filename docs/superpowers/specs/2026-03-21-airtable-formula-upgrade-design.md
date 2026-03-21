# Airtable Formula Extension — Upgrade Design Spec
**Date:** 2026-03-21
**Status:** Approved

---

## Overview

Upgrade `VSCode-Airtable-Formula` from a formula-only editor extension into a full Airtable developer platform for VS Code, adding:

1. A React webview dashboard (Overview / Setup / Settings)
2. One-click MCP server installation and multi-IDE configuration
3. AI files installer (skills, rules, workflows, agents) — formula-specific content
4. Native VS Code MCP server registration

All existing formula features (syntax highlighting, IntelliSense, beautify, minify, diagnostics, snippets) are **preserved unchanged**.

---

## Repo Strategy — Two Separate Repos

| Repo | Role | Distribution |
|------|------|-------------|
| `mcp-internal-airtable` | MCP server. Browser auth, Airtable internal API, schema/field tools. Independent cycle. | Published to **npm** as `mcp-internal-airtable` |
| `VSCode-Airtable-Formula` | VS Code extension. Consumes the npm package. All UI and installer logic lives here. | Published to **VS Code Marketplace** |

**Rationale:** The MCP server must remain independently usable (Claude Desktop, Cursor direct config, MKG workflow scripts) without the extension. Independent versioning prevents coupling.

### Linking Strategy
- **Dev:** `pnpm link` / `packages/extension/package.json` workspace path override
- **Production:** `"mcp-internal-airtable": "^2.0.0"` from npm (in `devDependencies` — NOT `bundleDependencies`)
- **Build:** A `scripts/bundle-mcp.mjs` copy step resolves the package's pre-built `dist/server.mjs` via `require.resolve('mcp-internal-airtable/dist/server.mjs')` and copies it → `packages/extension/dist/mcp/server.mjs` before `vsce package` runs
- **VSIX:** `vsce package --no-dependencies` — tsup has already bundled all runtime code including the server file. `bundleDependencies` is NOT used (it conflicts with `--no-dependencies`). The server lands in `dist/mcp/` via the copy step alone.

### Extension ID Continuity
The existing publisher and extension name (`publisher.airtable-formula`) are **kept unchanged** so existing Marketplace installs receive the upgrade automatically. No user action required.

---

## Monorepo Structure

Three packages under pnpm workspaces:

```
VSCode-Airtable-Formula/
├── packages/
│   ├── extension/              # VS Code host — TypeScript + tsup
│   │   ├── src/
│   │   │   ├── extension.ts          # Activation entry, MCP registration
│   │   │   ├── auto-config/          # Multi-IDE config generator + merge logic
│   │   │   ├── webview/              # DashboardProvider (panel lifecycle + messaging)
│   │   │   ├── mcp/                  # Re-exports bundled server path constant
│   │   │   ├── skills/               # AI file installer (upgraded from existing)
│   │   │   ├── commands/             # Existing: beautify, minify, formatting
│   │   │   ├── providers/            # Existing: completions, hover, diagnostics, signature
│   │   │   └── vendor/               # Existing: beautifier/minifier engines
│   │   ├── package.json              # declares contributes block, devDependencies
│   │   └── tsconfig.json
│   ├── webview/                # React + Vite dashboard UI
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── tabs/
│   │   │   │   ├── Overview.tsx
│   │   │   │   ├── Setup.tsx
│   │   │   │   └── Settings.tsx
│   │   │   ├── store.ts              # Zustand — IDE status, MCP info, settings
│   │   │   ├── styles.css            # Airtable 2026 tokens + Tailwind v4
│   │   │   └── lib/vscode.ts         # postMessage wrapper
│   │   └── vite.config.ts            # outputs to packages/extension/dist/webview/
│   └── shared/                 # Types: extension ↔ webview IPC
│       └── src/
│           ├── messages.ts
│           └── types.ts
├── scripts/
│   └── bundle-mcp.mjs              # esbuild step: copies MCP server into dist/
├── airtable-formula/               # Original extension (deleted after v2.0 ships)
├── Research/
├── docs/
└── package.json                    # pnpm workspace root
```

---

## Extension Manifest — `packages/extension/package.json`

### Engine floor
```json
"engines": { "vscode": "^1.100.0" }
```
`mcpServerDefinitionProviders` requires VS Code ≥ 1.99 (released March 2025).

### Activation
```json
"activationEvents": ["onStartupFinished"]
```
Activates once on every VS Code launch (acceptable — same as Perplexity). All formula provider commands are registered inside `activate()`, so no `onLanguage:airtable-formula` event needed separately.

### Contributes block additions
```jsonc
"contributes": {
  // Existing (unchanged): languages, grammars, snippets, themes, commands for beautify/minify

  // NEW — commands
  "commands": [
    { "command": "airtable-formula.openDashboard",  "title": "Airtable Formula: Open Dashboard" },
    { "command": "airtable-formula.setupAll",       "title": "Airtable Formula: Setup All IDEs" },
    { "command": "airtable-formula.refreshStatus",  "title": "Airtable Formula: Refresh Status" }
  ],

  // NEW — webview panel (shows as tab in editor area or sidebar)
  "views": {
    "airtable-formula-container": [
      { "type": "webview", "id": "airtable-formula.dashboard", "name": "Airtable Formula" }
    ]
  },
  "viewsContainers": {
    "activitybar": [
      { "id": "airtable-formula-container", "title": "Airtable Formula", "icon": "images/icon.svg" }
    ]
  },

  // NEW — settings (appear in VS Code Settings UI)
  "configuration": {
    "title": "Airtable Formula",
    "properties": {
      "airtableFormula.mcp.autoConfigureOnInstall": { "type": "boolean", "default": true },
      "airtableFormula.mcp.serverPathOverride":     { "type": "string",  "default": "" },
      "airtableFormula.mcp.notifyOnUpdates":        { "type": "boolean", "default": true },
      "airtableFormula.ai.autoInstallFiles":        { "type": "boolean", "default": true },
      "airtableFormula.ai.includeAgents":           { "type": "boolean", "default": false },
      "airtableFormula.formula.formatterVersion":   { "type": "string",  "default": "v2", "enum": ["v1","v2"] },
      "airtableFormula.formula.defaultBeautifyStyle":{ "type": "string", "default": "readable" }
    }
  },

  // NEW — native MCP registration
  "mcpServerDefinitionProviders": [
    { "id": "AirtableFormula.server", "label": "Airtable Internal MCP" }
  ]
}
```

### VSIX packaging
- `mcp-internal-airtable` is in `devDependencies` — NOT `bundleDependencies` (they conflict with `--no-dependencies`)
- Webview Vite output dir: `packages/extension/dist/webview/` — included automatically
- `.vscodeignore` excludes `airtable-formula/`, `packages/webview/src/`, `packages/shared/src/`, `node_modules/`
- `vsce package --no-dependencies` — tsup + the MCP copy step have already produced the full `dist/`

---

## Build Pipeline

```
pnpm build
  ├── 1. pnpm -F shared build          # tsup → shared/dist/ (ESM)
  ├── 2. pnpm -F webview build          # vite → extension/dist/webview/
  ├── 3. node scripts/bundle-mcp.mjs    # copies mcp-internal-airtable/dist/server.mjs
  │                                     # → extension/dist/mcp/server.mjs
  └── 4. pnpm -F extension build        # tsup → extension/dist/extension.js (CJS)

pnpm package
  └── vsce package --no-dependencies   # produces .vsix
```

`bundle-mcp.mjs` resolves the server path via `require.resolve('mcp-internal-airtable/dist/server.mjs')` and copies with `fs.copyFile`. At runtime, the extension resolves the server path as:
```ts
const serverPath = path.join(context.extensionPath, 'dist', 'mcp', 'server.mjs');
```

---

## Webview Message Protocol

Discriminated union, push-from-extension model. Extension owns the polling loop and pushes state; webview requests actions.

### Extension → Webview (state pushes)
```ts
type ExtensionMessage =
  | { type: 'state:update'; payload: DashboardState }      // full state replace
  | { type: 'ide:status';   payload: IdeStatus[] }         // IDE scan result
  | { type: 'action:result'; id: string; ok: boolean; error?: string }
```

### Webview → Extension (action requests)
```ts
type WebviewMessage =
  | { type: 'action:setupIde';    id: string; ideId: IdeId }   // configure MCP + install AI files
  | { type: 'action:setupAll';    id: string }                  // setup all detected IDEs
  | { type: 'action:refresh';     id: string }                  // re-scan IDEs
  | { type: 'setting:change';     key: string; value: unknown } // write VS Code setting
  | { type: 'ready' }                                           // webview mounted, request initial state
```

`id` fields are `crypto.randomUUID()` correlation IDs for request/response pairing. The extension pushes a `state:update` immediately on `ready` and after every action.

### `DashboardState` shape
```ts
interface DashboardState {
  ideStatuses:  IdeStatus[];
  mcpVersion:   string;
  aiFilesCount: number;
}

interface IdeStatus {
  ideId:        IdeId;           // 'cursor' | 'windsurf' | 'claude-code' | ...
  detected:     boolean;
  mcpConfigured:boolean;
  aiFiles: {
    skills:    'ok' | 'missing' | 'partial';
    rules:     'ok' | 'missing' | 'partial';
    workflows: 'ok' | 'missing' | 'partial';
    agents:    'ok' | 'missing' | 'partial';
  };
}
```

---

## Multi-IDE Config — File Paths & Merge Strategy

### MCP config file paths per IDE

| IDE | Config file | Format |
|-----|------------|--------|
| Cursor | `~/.cursor/mcp.json` | JSON — merge `mcpServers` object |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | JSON — merge `mcpServers` |
| Windsurf Next | `~/.codeium/windsurf-next/mcp_config.json` | JSON — merge `mcpServers` |
| Claude Desktop (Win) | `%APPDATA%/Claude/claude_desktop_config.json` | JSON — merge `mcpServers` |
| Claude Desktop (Mac) | `~/Library/Application Support/Claude/claude_desktop_config.json` | JSON — merge |
| Claude Code | `~/.claude.json` | JSON — merge `mcpServers` |
| Cline | `~/.cline/data/settings/cline_mcp_settings.json` | JSON — merge |
| Amp | `~/.config/amp/settings.json` | JSON — merge `mcp.servers` |

### Merge algorithm (all IDEs)
1. Read file — if missing, start from `{}`
2. If file is malformed JSON → show error notification, abort (never overwrite corrupted config)
3. Deep-merge our server entry under the IDE's `mcpServers` key (or equivalent)
4. Write atomically: write to `.tmp` → `fs.rename` (prevents partial writes)
5. On success → push `state:update` to webview

### MCP server entry written
```json
{
  "command": "node",
  "args": ["/absolute/path/to/dist/mcp/server.mjs"],
  "env": { "AIRTABLE_HEADLESS_ONLY": "1" }
}
```

### `AIRTABLE_HEADLESS_ONLY`
Internal flag read by `mcp-internal-airtable`. When `"1"`, the server skips launching a visible Chrome window and runs in headless Playwright mode. Required for the extension context because showing a visible browser from a VS Code background process is disruptive. The login flow (which needs a visible browser) is handled separately by the MCP server's own auth command.

---

## AI Files — Install Paths Per IDE

Files deployed (content sourced from `MKG-Airtable-Formulas/Airtable/resources/` and `.agent/rules/`):

| IDE | skills | rules | workflows | agents |
|-----|--------|-------|-----------|--------|
| Windsurf | `.windsurf/skills/airtable-formula.md` | `.windsurf/rules/airtable-formula.md` | `.windsurf/workflows/airtable-formula.md` | n/a |
| Cursor | `.cursor/rules/airtable-formula.mdc` | `.cursor/rules/airtable-formula-rules.mdc` | n/a | n/a |
| VS Code | `.github/instructions/airtable-formula.instructions.md` | same file | n/a | n/a |
| Claude Code | `~/.claude/skills/airtable-formula/` | `~/.claude/skills/airtable-formula/` | `~/.claude/skills/airtable-formula/` | `~/.claude/skills/airtable-formula/` |
| Claude Desktop | n/a (no file-based AI config) | n/a | n/a | n/a |
| Cline | `.clinerules/airtable-formula.md` | same | n/a | n/a |

All files are written only if missing or if user triggers "Update AI files". Existing files are never overwritten silently.

---

## Webview CSP

The `DashboardProvider` sets the webview's `Content-Security-Policy`:

```
default-src 'none';
style-src ${webview.cspSource} 'unsafe-inline';
script-src ${webview.cspSource};
img-src ${webview.cspSource} data:;
font-src ${webview.cspSource};
```

`'unsafe-inline'` is required for Tailwind v4's CSS-in-JS style injection. No external network requests from the webview — all data flows through `postMessage`. No CDN fonts in production build (Inter is bundled via Vite/npm or falls back to system stack).

---

## Feature Scope

### Preserved (no changes)
- Syntax highlighting, IntelliSense, hover docs, diagnostics, code actions
- Beautify (6 styles) + Minify (5 levels)
- Snippet library, batch operations, all existing commands

### New — Webview Dashboard

**Overview tab:** 3 stat cards (IDEs configured, MCP version, AI files active) · IDE status list · alert banners with action CTAs · MCP server card · AI context callout

**Setup tab (IDE-centric):** Per-IDE card showing detection status + MCP sub-row + AI file pills · one-click "Setup →" configures MCP + installs AI files · not-detected IDEs as ghost cards · "+ Add manually"

**Settings tab:** Toggles + selects for MCP, AI files, formula engine preferences (mirror VS Code settings)

### New — Native MCP Registration

API accessed via duck-typing guard (confirmed from Perplexity-Internal-MCP production code, engine `^1.100.0`):

```ts
const ctor = (vscode as any).McpStdioServerDefinition;
if (!ctor) throw new Error("McpStdioServerDefinition unavailable");

const lmApi = (vscode as any).lm as {
  registerMcpServerDefinitionProvider?: (
    id: string,
    provider: {
      onDidChangeMcpServerDefinitions?: vscode.Event<void>;
      provideMcpServerDefinitions: () => Promise<unknown[]>;
    }
  ) => vscode.Disposable;
};

if (typeof lmApi?.registerMcpServerDefinitionProvider === "function") {
  context.subscriptions.push(
    lmApi.registerMcpServerDefinitionProvider("AirtableFormula.server", {
      onDidChangeMcpServerDefinitions: serverDefinitionsChanged.event,
      provideMcpServerDefinitions: async () => [
        new ctor("Airtable Internal MCP", process.execPath,
          [path.join(context.extensionPath, "dist", "mcp", "server.mjs")],
          { AIRTABLE_HEADLESS_ONLY: "1" }
        )
      ]
    })
  );
}
```

Guard ensures graceful degradation on older VS Code builds. `package.json` declares `"mcpServerDefinitionProviders": [{ "id": "AirtableFormula.server", "label": "Airtable Internal MCP" }]`.

---

## Design System

**Source:** Airtable 2026 production CSS — 283 extracted custom properties.

Key tokens:
```css
--bg:      #1D1F25   /* gray800 — default surface */
--bg-nav:  #181d26   /* mainNavBackground — header */
--bg-inset:#111215   /* gray900 — stat cards, inset areas */
--at-blue: #166EE1   /* primary CTAs, active tab, focus rings */
--at-pink: #DD04A8   /* AI features only */
```

Rules: blue = product UI · pink = AI sections only · rainbow gradient = AI badge only · 2px blue `border-top` on shell · Inter + system stack · JetBrains Mono for versions/code · responsive 280px → 520px+ via media queries · Logo = placeholder `div` replaced with dynamic Airtable SVG (colored by VS Code theme).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension host | TypeScript 5.x, VS Code API `^1.100.0`, tsup |
| Webview UI | React 19, Vite, Tailwind CSS v4, Zustand, Lucide React, Motion |
| Shared types | TypeScript, tsup (ESM) |
| MCP bundled | Node.js, `@modelcontextprotocol/sdk`, patchright (via npm package) |
| Package manager | pnpm workspaces |
| Testing | Vitest (webview unit), Mocha + `@vscode/test-electron` (extension integration) |

---

## Migration Plan

1. Create monorepo structure alongside existing `airtable-formula/`
2. Copy existing source files into `packages/extension/src/` — no rewrites
3. Wire new `extension.ts` entry that calls both existing providers and new dashboard activation
4. Build new packages (webview, shared) incrementally
5. Delete `airtable-formula/` folder after first successful VSIX build and smoke test
6. Extension ID unchanged throughout — existing users get upgrade via normal Marketplace update

---

## Out of Scope (Future Projects)
- Scripts / automation scripts extension
- Other Airtable product support (bases, automations, views)
- Non-formula AI content
