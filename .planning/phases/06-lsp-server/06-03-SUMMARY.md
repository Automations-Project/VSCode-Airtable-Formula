---
phase: 06-lsp-server
plan: 03
subsystem: lsp
tags: [vscode-languageserver, tcp, lockfile, language-services, net, stdio, binary]

# Dependency graph
requires:
  - phase: 06-01
    provides: lsp-server package scaffold with test files (tcp-server.test.ts)
  - phase: 06-02
    provides: lsp-convert.ts (6 conversion functions) and router.ts (routeDocument)
provides:
  - lockfile-writer.ts with writeLspPort() — atomic port_lsp update via tmp+rename
  - tcp-server.ts with startTcpServer() — multi-client 127.0.0.1 TCP bind + lockfile write
  - server.ts with registerHandlers() — per-connection TextDocuments + 4 LSP handlers
  - index.ts — binary entry point routing --tcp vs stdio with --stdio argv injection
  - dist/index.mjs (247 KB bundled binary, all language-services bundled via noExternal)
affects: [06-04, 06-05]

# Tech tracking
tech-stack:
  added:
    - node:net (net.createServer multi-client TCP)
    - vscode-jsonrpc/node (StreamMessageReader, StreamMessageWriter)
    - vscode-languageserver/node (createConnection, ProposedFeatures, TextDocuments)
    - vscode-languageserver-textdocument (TextDocument)
  patterns:
    - "Atomic lockfile write: writeFileSync to .lsp.tmp then renameSync to lockPath (T-06-03-02)"
    - "TCP port read inside 'listening' callback — server.address() is null before event fires"
    - "Per-connection TextDocuments: new TextDocuments(TextDocument) inside registerHandlers()"
    - "Push-based diagnostics: onDidChangeContent + sendDiagnostics (not pull-based diagnosticProvider)"
    - "Diagnostics cleared on onDidClose to avoid stale markers after file close"
    - "Argv injection: push --stdio if not present before createConnection() stdio mode"

key-files:
  created:
    - packages/lsp-server/src/lockfile-writer.ts
    - packages/lsp-server/src/tcp-server.ts
    - packages/lsp-server/src/server.ts
    - packages/lsp-server/src/index.ts
  modified: []

key-decisions:
  - "Correct language-services function names: formulaDiagnostics/scriptDiagnostics/automationDiagnostics (not getFormula*/getScript*/getAutomation* per plan spec)"
  - "server.ts created alongside lockfile-writer.ts/tcp-server.ts (needed as import for TCP server test viability)"
  - "signatureHelp guarded by engine !== 'formula' per D-08 — returns null for script/automation"

patterns-established:
  - "Pattern: TCP multi-client via net.createServer — NOT createClientSocketTransport (one-connection-only)"
  - "Pattern: lockfile port_lsp atomic write duplicates lockfile.js replace() write-only subset"
  - "Pattern: registerHandlers factory — called once per connection, creates fresh TextDocuments scope"

requirements-completed: [LSP-03, LSP-04, LSP-05]

# Metrics
duration: 15min
completed: 2026-05-14
---

# Phase 06 Plan 03: LSP Server Core Implementation Summary

**Four-file LSP server implementation: atomic lockfile writer, 127.0.0.1 multi-client TCP server, per-connection handler registration, and binary entry point — all 21 tests green, dist/index.mjs produced at 247 KB**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-14T23:17:00Z
- **Completed:** 2026-05-14T23:21:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Implemented `writeLspPort()` as an atomic write helper that merges `port_lsp` into daemon.lock using `writeFileSync(tmpPath) + renameSync()` — never writes directly to `lockPath` (T-06-03-02)
- Implemented `startTcpServer()` binding to `127.0.0.1:0` (loopback only, T-06-03-01), reading the OS-assigned port inside the `'listening'` callback (RESEARCH.md Pitfall 3), then writing it to the lockfile before resolving the promise
- Implemented `registerHandlers()` that creates a NEW `TextDocuments` instance per call (Pitfall 5 — per-connection state isolation), with push-based diagnostics, stale-diagnostic cleanup on file close, and formula-only signatureHelp (D-08)
- Implemented `index.ts` binary entry point: `--tcp` routes to `startTcpServer()`; stdio mode injects `--stdio` into argv if absent (Pitfall 7), then creates a standard `createConnection(ProposedFeatures.all)` connection
- All 3 Wave 0 tcp-server tests pass; full 21-test suite green; `pnpm -F airtable-user-lsp build` succeeds

## Task Commits

Each task was committed atomically:

1. **Task 1: lockfile-writer.ts + tcp-server.ts** - `a389224` (feat)
2. **Task 2: server.ts + index.ts** - `c47c433` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `packages/lsp-server/src/lockfile-writer.ts` - `writeLspPort(lockPath, port)`: atomic port_lsp merge using tmp file + rename; returns false (no throw) if lockfile absent
- `packages/lsp-server/src/tcp-server.ts` - `startTcpServer(options?)`: binds 127.0.0.1:0, writes port_lsp after listening, multi-client via net.createServer, per-socket createConnection + registerHandlers + dispose
- `packages/lsp-server/src/server.ts` - `registerHandlers(connection)`: new TextDocuments per call, push diagnostics, hover, completions, formula-only signatureHelp; caller does connection.listen()
- `packages/lsp-server/src/index.ts` - Binary entry: `--tcp` → startTcpServer(); else inject `--stdio`, createConnection, registerHandlers, listen

## Decisions Made
- Corrected all language-services function names from the plan's interface spec (`getFormulaDiagnostics` etc.) to actual exports (`formulaDiagnostics` etc.) — the plan spec didn't match the real API; fixed as Rule 1 auto-fix during build verification
- Created `server.ts` as a complete implementation (not a stub) alongside Task 1 files since `tcp-server.ts` imports `registerHandlers` from it — necessary for vitest to resolve the import chain and run tcp-server tests

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected language-services function names to match actual exports**
- **Found during:** Task 2 (build verification: `pnpm -F airtable-user-lsp build`)
- **Issue:** The plan's interface spec used names like `getFormulaDiagnostics`, `getFormulaCompletions`, `getFormulaHover`, `getFormulaSignatureHelp`, `getScriptDiagnostics`, `getScriptCompletions`, `getScriptHover`, `getAutomationDiagnostics`, `getAutomationCompletions`, `getAutomationHover`. None of these exist in `@airtable-formula/language-services`. esbuild reported 10 "No matching export" errors. Actual exported names are `formulaDiagnostics`, `formulaCompletions`, `formulaHover`, `formulaSignatureHelp`, `scriptDiagnostics`, `scriptCompletions`, `scriptHover`, `automationDiagnostics`, `automationCompletions`, `automationHover`. Signatures are also `(text, pos)` not `(text, position, uri?)`.
- **Fix:** Rewrote server.ts imports and all call sites to use the correct function names and signatures
- **Files modified:** `packages/lsp-server/src/server.ts`
- **Verification:** `pnpm -F airtable-user-lsp build` succeeded (247 KB dist/index.mjs produced); all 21 tests still pass
- **Committed in:** `c47c433` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in plan's interface spec vs actual language-services exports)
**Impact on plan:** Essential correctness fix. No scope creep — server.ts handler logic unchanged, only the import names corrected.

## Issues Encountered
- `server.ts` needed to exist before tcp-server tests could run (tcp-server imports registerHandlers). Created it as the full implementation immediately (rather than a stub) so tests could resolve the import chain — this meant Task 2's "server.ts" work was done alongside Task 1, but committed in Task 2 as planned.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 core LSP server files complete and tested
- Binary entry point produces 247 KB `dist/index.mjs` — ready for publish configuration
- TCP server writes `port_lsp` to daemon.lock atomically — daemon integration in 06-04 is unblocked
- 06-04 (VS Code extension integration) and 06-05 (documentation) can proceed

## Self-Check

- [x] `packages/lsp-server/src/lockfile-writer.ts` exists
- [x] `packages/lsp-server/src/tcp-server.ts` exists
- [x] `packages/lsp-server/src/server.ts` exists
- [x] `packages/lsp-server/src/index.ts` exists
- [x] Commit `a389224` exists (Task 1: lockfile-writer + tcp-server)
- [x] Commit `c47c433` exists (Task 2: server + index)
- [x] 21 tests pass (3 tcp-server + 7 lsp-convert + 11 router)
- [x] `dist/index.mjs` produced by build (247 KB)
- [x] lockfile-writer.ts contains `renameSync` and does NOT write directly to lockPath
- [x] tcp-server.ts contains `127.0.0.1` and does NOT contain `createClientSocketTransport`
- [x] server.ts: `new TextDocuments(TextDocument)` inside function body, not module-level
- [x] server.ts: `engine !== 'formula'` guard in `onSignatureHelp`
- [x] server.ts: `documents.onDidClose` present
- [x] index.ts: `process.argv.includes('--tcp')` and `process.argv.push('--stdio')`

## Self-Check: PASSED

---
*Phase: 06-lsp-server*
*Completed: 2026-05-14*
