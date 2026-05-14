---
phase: 06-lsp-server
reviewed: 2026-05-14T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - .github/workflows/release.yml
  - packages/lsp-server/package.json
  - packages/lsp-server/src/index.ts
  - packages/lsp-server/src/lockfile-writer.ts
  - packages/lsp-server/src/lsp-convert.ts
  - packages/lsp-server/src/router.ts
  - packages/lsp-server/src/server.ts
  - packages/lsp-server/src/tcp-server.ts
  - packages/lsp-server/src/test/lsp-convert.test.ts
  - packages/lsp-server/src/test/router.test.ts
  - packages/lsp-server/src/test/tcp-server.test.ts
  - packages/lsp-server/tsconfig.json
  - packages/lsp-server/tsup.config.ts
  - packages/lsp-server/vitest.config.ts
  - packages/mcp-server/src/daemon/launcher.js
  - packages/mcp-server/src/daemon/server.js
findings:
  critical: 3
  warning: 7
  info: 4
  total: 14
status: issues_found
---

# Phase 06: LSP Server — Code Review Report

**Reviewed:** 2026-05-14
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

The lsp-server package is overall well-structured. The TCP server correctly binds to `127.0.0.1`, per-connection isolation for `TextDocuments` is sound, and the `lsp-convert.ts` enum offset logic is correct and well-tested. The daemon integration in `launcher.js` is competently handled. However, three blockers need attention: a missing socket error handler that causes uncaught exceptions in TCP mode; a SIGTERM race in the launcher's `finalize()` that silently drops the SIGTERM to `lspChild` if the child exits before shutdown; and a critical release-workflow issue where `target=both` never bumps or publishes the LSP server version. Several warnings cover partial LSP capabilities, an unsafe `as` cast for `tcpServer.address()`, `commitCharacters` silently dropped from completion items, and a double-SIGTERM risk from two independent code paths both calling `lspChild.kill('SIGTERM')`.

---

## Critical Issues

### CR-01: TCP socket missing `error` event handler — uncaught exception crashes process

**File:** `packages/lsp-server/src/tcp-server.ts:33-42`

**Issue:** The `net.createServer` callback creates a `socket` and immediately wraps it in an LSP `StreamMessageReader`/`StreamMessageWriter`, but never attaches a `socket.on('error', ...)` handler. In Node.js, an `EventEmitter` with no `error` listener throws the error as an uncaught exception when the underlying TCP socket emits an `ECONNRESET`, `EPIPE`, or similar network error. A single misbehaving editor client can crash the entire LSP server process, taking down all other connected clients with it. This is a direct correctness issue: multi-client safety requires each socket's error to be isolated.

**Fix:**
```typescript
const tcpServer = net.createServer((socket) => {
  // Isolate per-socket errors — without this, ECONNRESET/EPIPE are uncaught exceptions
  socket.on('error', (err) => {
    // ECONNRESET is expected when editors close abruptly — not worth logging
    if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
      process.stderr.write(`[airtable-user-lsp] socket error: ${err.message}\n`);
    }
    socket.destroy();
  });
  const reader = new StreamMessageReader(socket);
  const writer = new StreamMessageWriter(socket);
  const connection = createConnection(ProposedFeatures.all, reader, writer);
  registerHandlers(connection);
  connection.listen();
  socket.on('close', () => connection.dispose());
});
```

---

### CR-02: `release.yml` — `target=both` never bumps or publishes lsp-server

**File:** `.github/workflows/release.yml:154,288`

**Issue:** The `Bump LSP server version` step (line 154) runs only when `inputs.target == 'lsp-server'`. The commit-and-tag step (line 288) likewise gates on `inputs.target == 'lsp-server'`. The `both` option is defined in the workflow's `options` list (line 13) but only covers `extension` + `mcp-server`. If an operator selects `target=both` intending to ship all three packages, the LSP server is silently skipped — version not bumped, not published, no tag created. Since `both` is a visible menu option, operators will reasonably expect it to include the LSP server, and the silent omission is a correctness defect.

**Fix:** Either:
1. Rename `both` to `ext+mcp` to make the scope explicit and remove ambiguity, or
2. Add a fourth combined option `all` (or expand `both`) that includes lsp-server in all bump/publish/tag steps:

```yaml
# In the Bump LSP server version step:
if: inputs.target == 'lsp-server' || inputs.target == 'both'

# In the Publish LSP server step:
if: |
  !inputs.dry_run &&
  (inputs.target == 'lsp-server' || inputs.target == 'both')

# In the commit/tag step:
if [[ "${{ inputs.target }}" == "lsp-server" || "${{ inputs.target }}" == "both" ]]; then
  git add packages/lsp-server/package.json
  TARGETS="${TARGETS} lsp-server v${{ steps.lsp_version.outputs.next }}"
  TAGS="${TAGS} lsp-server/v${{ steps.lsp_version.outputs.next }}"
fi
```

---

### CR-03: `launcher.js` — SIGTERM to `lspChild` is silently lost when child already exited

**File:** `packages/mcp-server/src/daemon/launcher.js:291-305`

**Issue:** `finalize()` calls `lspChild?.kill('SIGTERM')` at line 300. The `lspChild.on('exit', ...)` handler at line 361 sets `lspChild = null` when the child exits. There is a race: if the LSP subprocess exits (for any reason) between the time `server.setLspChild(lspChild)` is called and the time `finalize()` runs, `lspChild` is `null` in the closure captured by `finalize()` but the copy sent to `server.setLspChild()` is the original reference. `server.stop()` will then call `options.lspChild.kill('SIGTERM')` via the `setLspChild` path, while `finalize()` calls `lspChild?.kill('SIGTERM')` on a `null` reference — the SIGTERM goes nowhere.

More critically: when the daemon receives SIGTERM, `signalHandler` calls `close()`, which calls `server.stop()` then `finalize()`. `server.stop()` runs its own `lsp-child` shutdown step (line 264-268) using `options.lspChild`, and `finalize()` also calls `lspChild?.kill('SIGTERM')` (line 300). If the child is still alive, it receives SIGTERM twice.

**Fix:** Consolidate LSP child ownership in one place. Since `launcher.js` spawns the child, it should own the SIGTERM. Remove the `setLspChild` / `lsp-child` shutdown step from `server.js` entirely, and rely solely on `finalize()` in `launcher.js`. The `server.js` `stop()` should remain unaware of the LSP subprocess.

```javascript
// In server.js: remove the 'lsp-child' runShutdownStep block (lines 264-268)
// and remove the setLspChild method from the returned object.

// In launcher.js finalize(): lspChild reference is already in the closure — keep as-is
// but ensure the child reference is not nulled before finalize() runs during normal shutdown.
```

---

## Warnings

### WR-01: `lockfile-writer.ts` — `renameSync` is not atomic on all platforms (cross-device)

**File:** `packages/lsp-server/src/lockfile-writer.ts:25`

**Issue:** `renameSync(tempPath, lockPath)` is atomic only when both paths are on the same filesystem. If `AIRTABLE_USER_MCP_HOME` is set to a path on a different drive or mount point from `os.tmpdir()` (rare but possible), the rename will throw `EXDEV`. The temp file is written to `${lockPath}.lsp.tmp` in the same directory as the lockfile, so cross-device is unlikely in practice, but writing `tempPath = lockPath + '.lsp.tmp'` relative to the same directory (not `os.tmpdir()`) is the correct pattern and is already done here. No code change needed, but the comment on line 25 should clarify this guarantee explicitly to prevent future refactors from moving `tempPath` to `tmpdir()`.

**Fix:** Add a comment clarifying the co-location requirement:
```typescript
const tempPath = `${lockPath}.lsp.tmp`; // Must be same directory as lockPath for atomic rename
```

---

### WR-02: `tcp-server.ts` — unsafe `as net.AddressInfo` cast without null guard

**File:** `packages/lsp-server/src/tcp-server.ts:53`

**Issue:** `const addr = tcpServer.address() as net.AddressInfo;` performs an unchecked cast. `server.address()` returns `AddressInfo | string | null`. The cast will not fail at runtime here because this code runs inside the `'listening'` callback (where `address()` is guaranteed non-null for TCP servers), but it silently assumes it is never a `string` (returned for IPC/pipe servers). If the code is ever refactored and this callback is moved or reused, the cast hides the real type. The pattern in `server.js` handles this correctly with a helper `getBoundPort()` that guards against `string` and `null`.

**Fix:**
```typescript
const rawAddr = tcpServer.address();
if (!rawAddr || typeof rawAddr === 'string') {
  reject(new Error('TCP server address is unavailable after listen'));
  return;
}
const addr = rawAddr as net.AddressInfo;
writeLspPort(lockPath, addr.port);
resolve();
```

---

### WR-03: `server.ts` — `signatureHelpProvider` advertised for all language IDs but only works for formula

**File:** `packages/lsp-server/src/server.ts:68-72`

**Issue:** `connection.onInitialize` unconditionally advertises `signatureHelpProvider` capability with trigger characters `['(', ',']`. The handler at line 113 silently returns `null` for `script` and `automation` documents. Editors that open `.ats` or `.ata` files will register the capability and fire `textDocument/signatureHelp` requests, all of which return `null`. This is not incorrect per the LSP spec (null is valid), but it is misleading and wastes round-trips. The proper pattern is to either advertise the capability only when a formula document is opened (via dynamic registration) or to always advertise it and accept the null responses. The current approach also means there is no way for an editor to know that `.ats` files don't support signature help without the silent null.

**Fix:** Document the intentional behavior, or use dynamic capability registration per document. At minimum, add an explicit comment in the `onInitialize` return explaining that `signatureHelp` is formula-engine only and script/automation will always return null.

---

### WR-04: `lsp-convert.ts` — `commitCharacters` field silently dropped from `CompletionItem`

**File:** `packages/lsp-server/src/lsp-convert.ts:50-63`

**Issue:** `LsCompletionItem` in `language-services/src/types.ts` declares `commitCharacters?: string[]`. The `toLspCompletionItem` function maps all other optional fields (`kind`, `detail`, `documentation`, `insertText`, `filterText`, `sortText`) but never maps `commitCharacters`. Any engine that sets `commitCharacters` on a completion item will have those characters silently dropped when the item is sent to the LSP client. While no engine currently sets `commitCharacters`, the interface promises the field and the converter violates it.

**Fix:**
```typescript
if (item.commitCharacters !== undefined) ci.commitCharacters = item.commitCharacters;
```

---

### WR-05: `release.yml` — LSP server `Build LSP server` step runs after `pnpm build` already built everything

**File:** `.github/workflows/release.yml:255-257`

**Issue:** The workflow runs `pnpm build` at line 195 (which builds all packages including lsp-server via tsup) and then has a separate `Build LSP server` step at line 255 that re-runs `pnpm -F airtable-user-lsp build`. This means the LSP server is built twice on every `target=lsp-server` run. For `target=extension` or `target=mcp-server`, the extra step is gated out (`if: inputs.target == 'lsp-server'`) but this also means that if `pnpm build` fails to build lsp-server (e.g., it's excluded from the workspace build), the re-build step would catch it — but only for the lsp-server target. The duplicate build wastes CI time and creates a false safety net.

**Fix:** Remove the separate `Build LSP server` step. The `pnpm build` step at line 195 already covers all packages. If lsp-server needs an isolated build check, use `pnpm -F airtable-user-lsp test` in the test step instead.

---

### WR-06: `launcher.js` — `buildRecord` always writes `port_lsp: null`, overwriting the real value

**File:** `packages/mcp-server/src/daemon/launcher.js:277-285`

**Issue:** The `buildRecord()` helper at line 277 hardcodes `port_lsp: null`. This record is written to the lockfile by `syncLockfile()` (line 288). When `syncLockfile()` is called after the LSP child has already written its actual `port_lsp` (via `lockfile-writer.ts`), the `replace()` call in `syncLockfile` overwrites the correct `port_lsp` value with `null`.

The token rotation path (`onTokenRotated`, line 327-329) calls `syncLockfile(nextToken.bearerToken)`, which calls `replace(buildRecord(...), ...)`. If `port_lsp` was already written by the LSP child before token rotation, the rotation event zeroes out `port_lsp` in the lockfile. Clients reading `port_lsp` after token rotation would see `null` and conclude LSP is unavailable.

**Fix:** `buildRecord` should read the current `port_lsp` from the existing lockfile rather than hardcoding `null`:
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
    tunnelUrl: null,
  };
};
```

---

### WR-07: `server.ts` — `documents.listen(connection)` called before `connection.listen()` in stdio mode

**File:** `packages/lsp-server/src/server.ts:123` and `packages/lsp-server/src/index.ts:22`

**Issue:** `registerHandlers(connection)` calls `documents.listen(connection)` at line 123 but explicitly delegates `connection.listen()` to the caller (documented comment: "Caller is responsible for calling connection.listen()"). In `index.ts` stdio mode, `connection.listen()` is called at line 23. This ordering is correct. However, in `tcp-server.ts` at line 40, `connection.listen()` is called after `registerHandlers(connection)`. The `documents.listen(connection)` call inside `registerHandlers` hooks into the connection's message dispatcher, but the connection has not started processing messages yet — this is fine because `listen()` starts the message loop. The warning here is that the comment in `server.ts` says "Caller is responsible for calling `connection.listen()`" but does NOT say "call it after `registerHandlers`". If a future caller calls `connection.listen()` before `registerHandlers`, the `TextDocuments` instance will not be attached and all document-change events will be silently lost. The API contract needs to be made explicit.

**Fix:** Update the `registerHandlers` docstring to state explicitly that `connection.listen()` must be called AFTER `registerHandlers`:
```typescript
/**
 * Register all LSP handlers on a connection.
 * ...
 * IMPORTANT: Call connection.listen() AFTER this function returns, never before.
 */
```

---

## Info

### IN-01: `lsp-convert.test.ts` — `toLspDiagnostic`, `toLspHover`, `toLspSignatureHelp`, `toLspCompletionItem` have zero test coverage

**File:** `packages/lsp-server/src/test/lsp-convert.test.ts:1-30`

**Issue:** The test file only covers `toLspSeverity` and `toLspCompletionKind`. The four composite converters (`toLspDiagnostic`, `toLspHover`, `toLspSignatureHelp`, `toLspCompletionItem`) — which contain actual logic (optional field mapping, kind/markdown conversion, relatedInformation mapping) — have no tests. The `commitCharacters` omission (WR-04) would have been caught with a `toLspCompletionItem` test.

**Fix:** Add tests for the composite converters covering at minimum: optional fields present vs absent, `relatedInformation` mapping, markdown vs plaintext documentation kind, and the `SignatureInformation` shape.

---

### IN-02: `router.test.ts` — no test for malformed URI fallback

**File:** `packages/lsp-server/src/test/router.test.ts`

**Issue:** `routeDocument` has a `try/catch` around `new URL(uri)` that returns `null` on malformed URIs. No test exercises this path. A malformed URI that somehow reaches the router (e.g., from a non-standard editor) would silently return `null` with no visibility that the catch branch was taken.

**Fix:** Add:
```typescript
it('returns null for malformed URI', () => {
  expect(routeDocument('not-a-uri-at-all', undefined)).toBeNull();
});
```

---

### IN-03: `tsconfig.json` — `declaration: false` means no `.d.ts` emitted

**File:** `packages/lsp-server/tsconfig.json:12`

**Issue:** `"declaration": false` suppresses `.d.ts` output. For a CLI binary-only package this is fine, but `tsup.config.ts` also sets `dts: false`. If the package ever exports types for use by other workspace packages (e.g., the extension consuming `StartTcpServerOptions`), adding `dts: true` later requires a tsup change. The current state is intentional for a binary-only package but worth noting.

**Fix:** No immediate change needed. Document intent with a comment in `tsup.config.ts`:
```typescript
dts: false, // Binary-only package; no type exports consumed by other packages
```

---

### IN-04: `release.yml` — `ovsx publish` uses `--pat $OVSX_PAT` (shell variable expansion, not `${{ secrets }}`)

**File:** `.github/workflows/release.yml:240`

**Issue:** The Open VSX publish step passes the PAT via `--pat $OVSX_PAT` where `$OVSX_PAT` is a shell variable expanded from the `env:` block (`OVSX_PAT: ${{ secrets.OVSX_PAT }}`). This is the correct pattern (secret passed via env, not interpolated directly into the command string), but it differs from the Marketplace publish step which uses `env: VSCE_PAT:` and the tool reads it implicitly. The inconsistency is not a security bug, but it is a style inconsistency that can cause confusion. Additionally, if `secrets.OVSX_PAT` is not set, `$OVSX_PAT` expands to an empty string and `ovsx publish` will fail with a non-obvious authentication error rather than a clear "secret not configured" message.

**Fix:** Add a preflight check or clarifying comment:
```yaml
- name: Publish extension to Open VSX
  if: |
    !inputs.dry_run &&
    (inputs.target == 'extension' || inputs.target == 'both')
  run: |
    if [[ -z "$OVSX_PAT" ]]; then
      echo "::error::OVSX_PAT secret is not configured"
      exit 1
    fi
    npx ovsx publish "${{ steps.vsix.outputs.file }}" --pat "$OVSX_PAT"
  env:
    OVSX_PAT: ${{ secrets.OVSX_PAT }}
```

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
