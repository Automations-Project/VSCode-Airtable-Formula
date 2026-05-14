---
phase: 06-lsp-server
verified: 2026-05-14T21:00:00Z
status: human_needed
score: 4/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Trigger the GitHub Actions release workflow with target=lsp-server, bump=patch, dry_run=false"
    expected: "npm publish succeeds; `npm view airtable-user-lsp version` returns a valid semver; `npx airtable-user-lsp --stdio` starts a working LSP server process"
    why_human: "The npm package airtable-user-lsp is not published (confirmed: `npm view airtable-user-lsp version` returns nothing). The release pipeline is fully wired in release.yml but requires a human to trigger the GitHub Actions workflow. Cannot publish from local verification."
---

# Phase 6: LSP Server Verification Report

**Phase Goal:** Language intelligence is available to any LSP-capable editor via a publicly installable npm package, with a shared daemon instance for multi-client efficiency
**Verified:** 2026-05-14T21:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| #  | Truth                                                                                                                       | Status          | Evidence |
|----|-----------------------------------------------------------------------------------------------------------------------------|-----------------|----------|
| 1  | A developer running `npx airtable-user-lsp --stdio` gets a working LSP server without installing anything beyond Node.js   | ? NEEDS HUMAN   | Package not yet published: `npm view airtable-user-lsp version` returns nothing. Release pipeline is wired (release.yml Bump/Build/Publish LSP server steps confirmed present), but workflow has not been triggered. |
| 2  | An editor receives diagnostics, completions, and hover for `.formula`, `.ats`, and `.ata` files                             | ✓ VERIFIED      | `server.ts:registerHandlers()` routes via `routeDocument()`, calls `formulaDiagnostics/Completions/Hover`, `scriptDiagnostics/Completions/Hover`, `automationDiagnostics/Completions/Hover`; push-based via `sendDiagnostics`; `onCompletion`/`onHover` handlers complete. All correct function names from actual language-services API. |
| 3  | The LSP server starts and serves requests with no daemon running — standalone                                               | ✓ VERIFIED      | `index.ts`: `--tcp` flag absent → stdio mode; `createConnection(ProposedFeatures.all)` + `registerHandlers` + `connection.listen()`. No daemon dependency in stdio path. |
| 4  | External editors discover `port_lsp` from `daemon.lock`; `--stdio` always starts fresh in-process (no daemon proxy)        | ✓ VERIFIED      | `tcp-server.ts:startTcpServer()` binds `127.0.0.1:0` and calls `writeLspPort(lockPath, addr.port)`. Daemon's `launcher.js` spawns `airtable-user-lsp --tcp` after `syncLockfile()`. `index.ts` stdio mode never proxies — always creates a direct connection. |
| 5  | The daemon lockfile contains a `port_lsp` field LSP clients can read to discover the shared LSP port                       | ✓ VERIFIED      | `lockfile-writer.ts:writeLspPort()`: reads existing JSON, merges `{ port_lsp: port }`, writes atomically via `writeFileSync(tempPath) + renameSync(tempPath, lockPath)`. Called inside `'listening'` callback in `tcp-server.ts`. Daemon's `launcher.js` confirmed contains `port_lsp` field in `buildRecord()` (line 258: `port_lsp: null`). |

**Score:** 4/5 truths verified (1 needs human — npm publish)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/lsp-server/package.json` | Package identity, bin entry, publishConfig | ✓ VERIFIED | `name: "airtable-user-lsp"`, `bin: {"airtable-user-lsp": "dist/index.mjs"}`, `publishConfig: {access:"public", provenance:true}` |
| `packages/lsp-server/tsup.config.ts` | Bundle config with noExternal | ✓ VERIFIED | `noExternal: ['@airtable-formula/language-services']`, entry `src/index.ts`, format ESM, `.mjs` output |
| `packages/lsp-server/vitest.config.ts` | Test runner config | ✓ VERIFIED | `include: ['src/test/**/*.test.ts']` |
| `packages/lsp-server/src/lsp-convert.ts` | 6 LsXxx→LSP conversion functions | ✓ VERIFIED | Exports `toLspSeverity`, `toLspCompletionKind`, `toLspDiagnostic`, `toLspHover`, `toLspCompletionItem`, `toLspSignatureHelp`. +1 offset: `(s + 1)` for severity, `(k + 1)` for completion kind. |
| `packages/lsp-server/src/router.ts` | Language ID + extension routing | ✓ VERIFIED | `routeDocument()` with `LANG_TO_ENGINE` and `EXT_TO_ENGINE` maps; try/catch for malformed URIs; returns null for unknown. |
| `packages/lsp-server/src/lockfile-writer.ts` | Atomic port_lsp write | ✓ VERIFIED | `writeLspPort()`: reads JSON, merges, writes to `.lsp.tmp`, then `renameSync`. Returns false if file absent. Never writes directly to `lockPath`. |
| `packages/lsp-server/src/tcp-server.ts` | Multi-client TCP server | ✓ VERIFIED | `net.createServer`, binds `127.0.0.1:0`, reads port in `'listening'` callback, calls `writeLspPort`. Per-socket `createConnection + registerHandlers + connection.listen()`. |
| `packages/lsp-server/src/server.ts` | LSP handler registration | ✓ VERIFIED | `registerHandlers(connection)`: `new TextDocuments(TextDocument)` INSIDE function body (per-connection). Push diagnostics, `onCompletion`, `onHover`, `onSignatureHelp` (formula-only guard: `engine !== 'formula'`). `onDidClose` clears diagnostics. |
| `packages/lsp-server/src/index.ts` | Binary entry point | ✓ VERIFIED | `process.argv.includes('--tcp')` routing; `process.argv.push('--stdio')` injection if absent; stdio mode: `createConnection(ProposedFeatures.all)`. |
| `packages/lsp-server/src/test/lsp-convert.test.ts` | Wave 0 test scaffold | ✓ VERIFIED | Contains `toLspSeverity`, uses `.js` import extension. |
| `packages/lsp-server/src/test/router.test.ts` | Wave 0 test scaffold | ✓ VERIFIED | Contains `routeDocument`, uses `.js` import extension. |
| `packages/lsp-server/src/test/tcp-server.test.ts` | Wave 0 test scaffold | ✓ VERIFIED | Contains `startTcpServer`, uses `.js` import extension. |
| `packages/mcp-server/src/daemon/launcher.js` | LSP subprocess spawn | ✓ VERIFIED | Contains `airtable-user-lsp`, `lspChild?.kill('SIGTERM')`, `AIRTABLE_USER_MCP_HOME: configDir`. No `detached: true` on lspChild. No `.unref()` on lspChild. |
| `packages/mcp-server/src/daemon/server.js` | lsp-child shutdown step | ✓ VERIFIED | `'lsp-child'` shutdown step in `stop()`, `setLspChild(child)` method on returned server object. |
| `.github/workflows/release.yml` | lsp-server release pipeline | ✓ VERIFIED | `lsp-server` in target options, `id: lsp_version` step, `npm view airtable-user-lsp version`, `pnpm -F airtable-user-lsp build`, `npm publish --provenance --access public`, commit `packages/lsp-server/package.json`, `lsp-server/vX.Y.Z` tag, GitHub Release step, Summary line. |
| `packages/lsp-server/README.md` | Standalone npm package docs | ✓ VERIFIED | Contains `npx airtable-user-lsp --stdio`, `## Features`, `## Editor Configuration`, `port_lsp` daemon TCP section, `.formula` file type table, `Node.js >= 20` requirement. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `tsup.config.ts` | `@airtable-formula/language-services` | `noExternal` array | ✓ WIRED | `noExternal: ['@airtable-formula/language-services']` confirmed present |
| `package.json` | `dist/index.mjs` | `bin` field | ✓ WIRED | `"airtable-user-lsp": "dist/index.mjs"` confirmed |
| `lsp-convert.ts` | `@airtable-formula/language-services` | import LsSeverity/LsCompletionItemKind | ✓ WIRED | `import { LsSeverity, LsCompletionItemKind } from '@airtable-formula/language-services'` |
| `router.ts` | `LANG_TO_ENGINE / EXT_TO_ENGINE` | `routeDocument` function | ✓ WIRED | Both maps present; `routeDocument` references both |
| `tcp-server.ts` | `lockfile-writer.ts` | `writeLspPort()` call | ✓ WIRED | Called inside `'listening'` callback after `server.address()` |
| `tcp-server.ts` | `server.ts` | `registerHandlers(connection)` per socket | ✓ WIRED | Confirmed — called per new socket connection |
| `server.ts` | `@airtable-formula/language-services` | engine imports | ✓ WIRED | Imports `formulaDiagnostics`, `formulaCompletions`, `formulaHover`, `formulaSignatureHelp`, `scriptDiagnostics`, `scriptCompletions`, `scriptHover`, `automationDiagnostics`, `automationCompletions`, `automationHover` — all match actual exports |
| `index.ts` | `startTcpServer / registerHandlers` | `process.argv.includes('--tcp')` branch | ✓ WIRED | `--tcp` → `startTcpServer()`; else → stdio createConnection |
| `launcher.js` | `airtable-user-lsp --tcp` | `spawn()` after `syncLockfile()` | ✓ WIRED | `spawn(process.execPath, [lspBin, '--tcp'], {...})` with `AIRTABLE_USER_MCP_HOME: configDir` |
| `launcher.js finalize()` | `lspChild.kill('SIGTERM')` | before `release()` | ✓ WIRED | `lspChild?.kill('SIGTERM')` at line 300, before `release()` call |
| `release.yml Commit step` | `packages/lsp-server/package.json` | `git add packages/lsp-server/package.json` | ✓ WIRED | `git add packages/lsp-server/package.json` in commit/tag step |

### Data-Flow Trace (Level 4)

Level 4 not applicable — the lsp-server package contains no components rendering dynamic data. It is a headless protocol server. Data flows through LSP protocol handlers, not through React/UI rendering pipelines.

### Behavioral Spot-Checks

Step 7b: SKIPPED — the LSP server requires a running process and connected LSP client to test behavior. No in-process entry point is testable without starting the server. The test suite verifies the conversion and routing logic; end-to-end protocol behavior requires a live LSP client connection.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| LSP-01 | 06-01, 06-05 | `airtable-user-lsp` publicly installable via npx | ? NEEDS HUMAN | Release pipeline wired. Package NOT yet on npm (`npm view airtable-user-lsp` returns nothing). Human must trigger release workflow. |
| LSP-02 | 06-02, 06-03 | Diagnostics, completions, hover for .formula/.ats/.ata | ✓ SATISFIED | `server.ts` handlers confirmed; routes to all three engines; all 6 engine functions use correct API signatures |
| LSP-03 | 06-02, 06-03 | Standalone stdio mode, no daemon required | ✓ SATISFIED | `index.ts` stdio mode creates direct connection; no daemon dependency |
| LSP-04 | 06-03, 06-04 | When daemon running, LSP TCP port discoverable; stdio always fresh in-process | ✓ SATISFIED | `launcher.js` spawns `--tcp`; `lockfile-writer.ts` writes `port_lsp`; `index.ts` stdio never proxies |
| LSP-05 | 06-03, 06-04 | Daemon lockfile includes `port_lsp` field | ✓ SATISFIED | `writeLspPort()` atomically updates `port_lsp`; `daemon.lock` schema includes `port_lsp: null` initialized by launcher |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| None found | — | — | — | No stubs, no TODO/FIXME comments, no placeholder returns, no hardcoded empty data in source files. |

**Notable implementation detail:** `server.ts` uses function-scoped `const documents = new TextDocuments(TextDocument)` (line 30 — inside `registerHandlers` body). This is the CORRECT pattern (per-connection state). The anti-pattern would be module-level declaration — that is NOT present.

**Function name correction (from SUMMARY):** The plan spec used `getFormulaDiagnostics` etc., but the actual language-services exports are `formulaDiagnostics` etc. The executor corrected this during implementation. Verified: `server.ts` uses `formulaDiagnostics`, `formulaCompletions`, etc., which match the actual exports in `packages/language-services/src/engines/formula/`.

### Human Verification Required

#### 1. Publish `airtable-user-lsp` to npm

**Test:** Navigate to the GitHub repository → Actions → Release workflow → Run workflow with `target=lsp-server`, `bump=patch`, `dry_run=false`. After workflow completes, run: `npm view airtable-user-lsp version` and `npx airtable-user-lsp --stdio`.

**Expected:**
- `npm view airtable-user-lsp version` returns a semver string (e.g., `1.0.0`)
- `npx airtable-user-lsp --stdio` starts the server process without error (process stays running, ready for LSP client connection)
- GitHub Release tagged `lsp-server/v1.0.0` created in the repository

**Why human:** The `airtable-user-lsp` package is not yet on npm (confirmed: `npm view airtable-user-lsp version` returns empty). All infrastructure is in place (release.yml pipeline, `packages/lsp-server/package.json` with `publishConfig.provenance: true`, build step). The publish requires manually triggering the GitHub Actions release workflow with a valid `NPM_TOKEN` secret configured in the repository.

### Gaps Summary

No structural gaps in the codebase — all source files exist, are substantive, and are correctly wired. The single outstanding item is that **LSP-01 requires npm publication** and the package has not yet been published. The release pipeline is complete and correct; a human must pull the trigger.

This is classified as `human_needed` because:
- All code is implemented and correct
- The release workflow is fully wired
- The outstanding step (triggering npm publish) is a human action, not a code gap

---

_Verified: 2026-05-14T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
