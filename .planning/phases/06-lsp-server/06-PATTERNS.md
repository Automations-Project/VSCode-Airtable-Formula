# Phase 6: LSP Server - Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 14 new/modified files
**Analogs found:** 12 / 14

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/lsp-server/package.json` | config | — | `packages/mcp-server/package.json` | exact (same bin+publishConfig pattern) |
| `packages/lsp-server/tsconfig.json` | config | — | `packages/language-services/package.json` build scripts | role-match |
| `packages/lsp-server/tsup.config.ts` | config | — | `packages/language-services/package.json` tsup script | role-match (no tsup.config.ts exists; inline script is the analog) |
| `packages/lsp-server/vitest.config.ts` | config | — | `packages/language-services/vitest.config.ts` | exact |
| `packages/lsp-server/src/index.ts` | utility | request-response | `packages/mcp-server/src/daemon/launcher.js` `resolveCliEntry()` + argv routing | partial-match |
| `packages/lsp-server/src/server.ts` | service | event-driven | `packages/mcp-server/src/daemon/server.js` `startDaemonServer()` | role-match (same handler-registration pattern) |
| `packages/lsp-server/src/lsp-convert.ts` | utility | transform | `packages/extension/src/language/convert.ts` | exact (mirrors Ls* → framework type pattern) |
| `packages/lsp-server/src/router.ts` | utility | request-response | `packages/extension/src/language/registration.ts` languageId dispatch map | role-match |
| `packages/lsp-server/src/tcp-server.ts` | service | event-driven | `packages/mcp-server/src/daemon/server.js` `listenAvoidingBlockedPorts()` / `startDaemonServer()` | role-match (net.Server listen pattern) |
| `packages/lsp-server/src/lockfile-writer.ts` | utility | file-I/O | `packages/mcp-server/src/daemon/lockfile.js` `replace()` | exact (minimal duplication of replace()) |
| `packages/lsp-server/src/test/lsp-convert.test.ts` | test | — | `packages/language-services/src/test/types.test.ts` | exact |
| `packages/lsp-server/src/test/router.test.ts` | test | — | `packages/language-services/src/test/types.test.ts` | exact |
| `packages/lsp-server/src/test/tcp-server.test.ts` | test | — | `packages/language-services/src/test/types.test.ts` | exact |
| `packages/mcp-server/src/daemon/launcher.js` (modified) | service | event-driven | self — adds LSP subprocess spawn after `syncLockfile()` call (line 329) | self-modification |
| `packages/mcp-server/src/daemon/server.js` (modified) | service | event-driven | self — shutdown path needs `lspChild.kill('SIGTERM')` | self-modification |
| `.github/workflows/release.yml` (modified) | config | — | self — duplicate the mcp-server target block (lines 110-149, 203-210, 226-229, 257-266) | self-modification |

---

## Pattern Assignments

### `packages/lsp-server/package.json` (config)

**Analog:** `packages/mcp-server/package.json` (lines 1-79)

**Full package structure pattern:**
```json
{
  "name": "airtable-user-lsp",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.mjs",
  "bin": { "airtable-user-lsp": "dist/index.mjs" },
  "engines": { "node": ">=20" },
  "files": ["dist/**", "README.md", "LICENSE"],
  "publishConfig": { "access": "public", "provenance": true },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Automations-Project/VSCode-Airtable-Formula.git",
    "directory": "packages/lsp-server"
  },
  "author": { "name": "Nskha", "url": "https://github.com/automations-Project" },
  "scripts": {
    "build": "tsup",
    "test": "vitest run"
  },
  "dependencies": {
    "vscode-languageserver": "^9.0.1",
    "vscode-languageserver-textdocument": "^1.0.12"
  },
  "devDependencies": {
    "@airtable-formula/language-services": "workspace:*",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

**Key differences from mcp-server:**
- `dist/index.mjs` not `src/index.js` (compiled output, not source)
- `files` uses `dist/**` not `src/**` (bundled, not source-published)
- `language-services` goes in `devDependencies` (bundled at build time, not a runtime dep)
- No `optionalDependencies` — no optional external binaries needed

---

### `packages/lsp-server/tsup.config.ts` (config)

**Analog:** `packages/language-services/package.json` build script (line 16: `tsup src/index.ts --format cjs,esm --dts --out-dir dist`)

No `tsup.config.ts` file exists in the codebase — all packages use inline `scripts.build`. For `lsp-server`, a `tsup.config.ts` is needed to express `noExternal`. Pattern is from RESEARCH.md (verified tsup docs):

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  target: 'node20',
  platform: 'node',
  bundle: true,
  noExternal: ['@airtable-formula/language-services'],
  dts: false,
  clean: true,
  outDir: 'dist',
});
```

**Critical:** `noExternal: ['@airtable-formula/language-services']` is mandatory — `language-services` is `"private": true` (confirmed in `packages/language-services/package.json` line 4) and cannot be an npm runtime dependency. Without this, `npx airtable-user-lsp` fails outside the monorepo with `ERR_MODULE_NOT_FOUND`.

---

### `packages/lsp-server/vitest.config.ts` (config)

**Analog:** `packages/language-services/vitest.config.ts` (lines 1-7) — exact copy

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
  },
});
```

Use `src/test/**/*.test.ts` glob (matches language-services pattern with `**` for subdirectories) rather than the extension's single-level `src/test/*.test.ts` glob, since tests may live in `src/test/` flat.

---

### `packages/lsp-server/src/index.ts` (utility, request-response)

**Analog:** `packages/mcp-server/src/daemon/launcher.js` `resolveCliEntry()` + argv routing (lines 29-33, 453-474)

**argv routing pattern** (from launcher.js lines 453-474, adapted to TypeScript):
```typescript
// Copy: argv-based mode detection (resolveCliEntry pattern from launcher.js lines 29-33)
const mode = process.argv.includes('--tcp') ? 'tcp' : 'stdio';

if (mode === 'tcp') {
  // startTcpServer() binds port 0, writes port_lsp to lockfile
  await startTcpServer();
} else {
  // Inject --stdio if editors omit it (RESEARCH.md Pitfall 7)
  if (!process.argv.includes('--stdio')) {
    process.argv.push('--stdio');
  }
  startStdioServer();
}
```

**Config dir resolution pattern** (from launcher.js line 13, `getHomeDir()` usage):
```javascript
// mcp-server pattern — adapt for lsp-server
import { getHomeDir } from '../paths.js';  // mcp-server: NOT available in lsp-server
// lsp-server equivalent: read AIRTABLE_USER_MCP_HOME env var directly
const configDir = process.env.AIRTABLE_USER_MCP_HOME ?? join(homedir(), '.airtable-user-mcp');
```

---

### `packages/lsp-server/src/server.ts` (service, event-driven)

**Analog:** `packages/mcp-server/src/daemon/server.js` `startDaemonServer()` (lines 77-288) — handler registration + lifecycle pattern

**Handler registration pattern** (adapted from server.js `app.get/post` registration style, lines 118-224):
```typescript
// One factory function called per connection (stdio and each TCP socket)
// Mirrors server.js pattern of registering all handlers in one function
export function registerHandlers(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);

  // languageId dispatch — mirrors registration.ts lines 20-127
  documents.onDidChangeContent(change => {
    const engine = routeDocument(change.document.uri, change.document.languageId);
    if (!engine) {
      connection.sendDiagnostics({ uri: change.document.uri, diagnostics: [] });
      return;
    }
    const diags = runDiagnostics(engine, change.document.getText(), change.document.uri);
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics: diags.map(toLspDiagnostic) });
  });

  // Clear diagnostics on close (RESEARCH.md Pitfall 4)
  documents.onDidClose(e => {
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  connection.onInitialize((): InitializeResult => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { resolveProvider: false, triggerCharacters: ['(', '{', "'", '"', '.'] },
      hoverProvider: true,
      signatureHelpProvider: { triggerCharacters: ['(', ','] },
    },
  }));

  connection.onCompletion(params => { /* ... */ });
  connection.onHover(params => { /* ... */ });
  connection.onSignatureHelp(params => { /* formula engine only — D-08 */ });

  documents.listen(connection);
  // caller calls connection.listen()
}
```

**Shutdown pattern** (from server.js `stop()` lines 247-274 — adapt for LSP):
```typescript
// Each TCP socket connection disposes on close (no explicit stop() needed)
socket.on('close', () => connection.dispose());
// For stdio: process exits naturally when stdin closes
```

---

### `packages/lsp-server/src/lsp-convert.ts` (utility, transform)

**Analog:** `packages/extension/src/language/convert.ts` (lines 1-84) — exact structural mirror

This is the primary analog. The extension's `convert.ts` maps `Ls*` → VS Code types; `lsp-convert.ts` maps `Ls*` → LSP protocol types. The structure is identical: one exported function per type.

**Imports pattern** (mirrors convert.ts lines 1-2):
```typescript
import type { LsPosition, LsRange, LsDiagnostic, LsHover, LsCompletionItem, LsSignatureHelp } from '@airtable-formula/language-services';
import { LsSeverity, LsCompletionItemKind } from '@airtable-formula/language-services';
import {
  DiagnosticSeverity, CompletionItemKind, type Diagnostic, type CompletionItem,
  type Hover, type SignatureHelp, type SignatureInformation, type ParameterInformation,
  Range, Position,
} from 'vscode-languageserver-types';
```

**Core conversion pattern** (extends convert.ts lines 20-84 — add +1 offset unlike VS Code's direct cast):

The critical difference vs. the VS Code analog: `convert.ts` line 25 uses direct cast (`d.severity as unknown as vscode.DiagnosticSeverity`) because `LsSeverity` mirrors VS Code numerics exactly. For LSP protocol, a +1 offset is needed (confirmed in RESEARCH.md):

```typescript
// VS Code convert.ts (lines 20-27) — DIRECT CAST (no offset):
// d.severity as unknown as vscode.DiagnosticSeverity

// LSP convert.ts — OFFSET REQUIRED (+1):
export function toLspSeverity(s: LsSeverity): DiagnosticSeverity {
  return (s + 1) as DiagnosticSeverity;
}
export function toLspCompletionKind(k: LsCompletionItemKind): CompletionItemKind {
  return (k + 1) as CompletionItemKind;
}
```

**toVscodeDiagnostic analog** (convert.ts lines 20-41 → toLspDiagnostic):
```typescript
// convert.ts lines 20-41 shape:
export function toVscodeDiagnostic(d: LsDiagnostic): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(toVscodeRange(d.range), d.message, d.severity as ...);
  if (d.code !== undefined) { diag.code = d.code; }
  if (d.source !== undefined) { diag.source = d.source; }
  if (d.relatedInformation) { diag.relatedInformation = d.relatedInformation.map(...); }
  return diag;
}
// lsp-convert.ts equivalent uses Range.create() and Diagnostic.create() instead of new vscode.*()
```

**toVscodeHover analog** (convert.ts lines 43-48 → toLspHover):
```typescript
// convert.ts lines 43-48:
export function toVscodeHover(h: LsHover): vscode.Hover {
  const content = h.contents.kind === 'plaintext' ? h.contents.value : new vscode.MarkdownString(h.contents.value);
  return new vscode.Hover(content, h.range ? toVscodeRange(h.range) : undefined);
}
// lsp-convert.ts: uses { kind: 'markdown'|'plaintext', value: string } object literal instead
```

**toVscodeCompletionItem analog** (convert.ts lines 50-67 → toLspCompletionItem):
```typescript
// convert.ts lines 50-67 — field-by-field optional assignment pattern:
if (item.insertText !== undefined) { vsItem.insertText = ...; }
if (item.detail !== undefined) { vsItem.detail = item.detail; }
if (item.documentation !== undefined) {
  vsItem.documentation = typeof item.documentation === 'string'
    ? item.documentation
    : new vscode.MarkdownString(item.documentation.value);
}
// lsp-convert.ts: same conditional field pattern; { kind: 'markdown', value } instead of new vscode.MarkdownString()
```

**toVscodeSignatureHelp analog** (convert.ts lines 69-84 → toLspSignatureHelp):
```typescript
// convert.ts lines 69-84 — signatures.map() pattern:
help.signatures = sh.signatures.map(sig => {
  const vsSig = new vscode.SignatureInformation(sig.label, sig.documentation ? new vscode.MarkdownString(sig.documentation) : undefined);
  vsSig.parameters = sig.parameters.map(p => new vscode.ParameterInformation(p.label, p.documentation));
  return vsSig;
});
help.activeSignature = sh.activeSignature;
help.activeParameter = sh.activeParameter;
// lsp-convert.ts: same shape; use SignatureInformation object literal instead of new vscode.SignatureInformation()
```

---

### `packages/lsp-server/src/router.ts` (utility, request-response)

**Analog:** `packages/extension/src/language/registration.ts` (lines 14-127) — languageId dispatch map

**Language ID → engine dispatch pattern** (from registration.ts lines 20-127, languageId string guards):
```typescript
// registration.ts uses literal string guards:
if (event.document.languageId === 'airtable-formula') { ... }
if (event.document.languageId === 'airtable-script') { ... }
if (event.document.languageId === 'airtable-automation') { ... }

// router.ts converts this to a lookup map (D-07):
const LANG_TO_ENGINE: Record<string, string> = {
  'airtable-formula': 'formula',
  'airtable-script': 'script',
  'airtable-automation': 'automation',
};
const EXT_TO_ENGINE: Record<string, string> = {
  '.formula': 'formula', '.fx': 'formula',
  '.ats': 'script', '.script': 'script',
  '.ata': 'automation', '.automation': 'automation',
};

export function routeDocument(uri: string, languageId?: string): 'formula' | 'script' | 'automation' | null {
  if (languageId && LANG_TO_ENGINE[languageId]) {
    return LANG_TO_ENGINE[languageId] as 'formula' | 'script' | 'automation';
  }
  const ext = path.extname(new URL(uri).pathname);
  return (EXT_TO_ENGINE[ext] ?? null) as 'formula' | 'script' | 'automation' | null;
}
```

**Trigger character pattern** (from registration.ts lines 50-54 and 86-88):
- Formula: `'(', '{', "'", '"'` (completions) + `'('`, `','` (signature help)
- Script/Automation: `'.'` only
- `signatureHelp` trigger chars `'('`, `','` match line 42 of registration.ts

---

### `packages/lsp-server/src/tcp-server.ts` (service, event-driven)

**Analog:** `packages/mcp-server/src/daemon/server.js` `listenAvoidingBlockedPorts()` + `startDaemonServer()` (lines 43-76, 230-237)

**net.Server listen + port read pattern** (from server.js lines 43-76):
```javascript
// server.js pattern (lines 43-76):
async function listenAvoidingBlockedPorts(server, requestedPort, host) {
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(requestedPort, host);
  });
  const boundPort = getBoundPort(server);  // server.address().port
}

function getBoundPort(server) {
  const address = server?.address();
  if (!address || typeof address === 'string') throw new Error('...');
  return address.port;
}
```

**tcp-server.ts adaptation** (multi-client socket handler — no analog in codebase, use RESEARCH.md Pattern 2):
```typescript
// Per-socket handler pattern (RESEARCH.md Pattern 2 — no codebase analog):
import * as net from 'net';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';

export async function startTcpServer(): Promise<void> {
  const configDir = process.env.AIRTABLE_USER_MCP_HOME
    ?? join(homedir(), '.airtable-user-mcp');
  const lockPath = join(configDir, 'daemon.lock');

  const tcpServer = net.createServer((socket) => {
    const reader = new StreamMessageReader(socket);
    const writer = new StreamMessageWriter(socket);
    const connection = createConnection(ProposedFeatures.all, reader, writer);
    registerHandlers(connection);
    connection.listen();
    socket.on('close', () => connection.dispose());
  });

  // Adapt server.js listenAvoidingBlockedPorts pattern (lines 43-67):
  await new Promise<void>((resolve, reject) => {
    tcpServer.once('error', reject);
    tcpServer.once('listening', () => { tcpServer.removeListener('error', reject); resolve(); });
    tcpServer.listen(0, '127.0.0.1');  // port 0 = OS-assigned
  });

  const port = (tcpServer.address() as net.AddressInfo).port;
  // Write port_lsp via lockfile-writer (see lockfile-writer.ts pattern below)
  writeLspPort(lockPath, port);
}
```

---

### `packages/lsp-server/src/lockfile-writer.ts` (utility, file-I/O)

**Analog:** `packages/mcp-server/src/daemon/lockfile.js` `replace()` function (lines 108-124)

**Exact source to duplicate** (lockfile.js lines 108-124, adapted to TypeScript with port_lsp write):
```javascript
// lockfile.js replace() — lines 108-124 (EXACT DUPLICATION TARGET):
export function replace(record, options = {}) {
  const lockPath = options.lockPath ?? getLockfilePath();
  const normalized = normalizeRecord(record);

  if (options.expectedUuid) {
    const current = read({ lockPath });
    if (!current || current.uuid !== options.expectedUuid) { return false; }
  }

  mkdirSync(dirname(lockPath), { recursive: true });
  const tempPath = `${lockPath}.tmp`;
  writeFileSync(tempPath, serialize(normalized), 'utf8');
  renameSync(tempPath, lockPath);
  return true;
}

// serialize() (lockfile.js line 219):
function serialize(record) {
  return JSON.stringify(record, null, 2) + '\n';
}
```

**lsp-server simplified write-only variant** (no `normalizeRecord` needed — only writes port_lsp field):
```typescript
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Minimal duplication of lockfile.js replace() — write-only, no acquisition
export function writeLspPort(lockPath: string, port: number): boolean {
  let existing: Record<string, unknown>;
  try {
    existing = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return false;  // lockfile not yet written by daemon — skip
  }
  const updated = { ...existing, port_lsp: port };
  const tempPath = `${lockPath}.tmp`;
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(tempPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  renameSync(tempPath, lockPath);  // atomic replace (lockfile.js line 123)
  return true;
}
```

**Key insight from lockfile.js:** The atomic write uses `writeFileSync(tempPath) + renameSync(temp, lock)` pattern (lines 121-123). This is the critical correctness pattern — never `writeFileSync(lockPath)` directly.

---

### Test files: `lsp-convert.test.ts`, `router.test.ts`, `tcp-server.test.ts` (test)

**Analog:** `packages/language-services/src/test/types.test.ts` (lines 1-79)

**Test file structure pattern** (types.test.ts lines 1-13):
```typescript
import { describe, it, expect } from 'vitest';
import type { LsDiagnostic } from '../index.js';
import { LsSeverity, LsCompletionItemKind } from '../index.js';

describe('language-services types', () => {
  it('LsSeverity values mirror vscode.DiagnosticSeverity (D-09)', () => {
    expect(LsSeverity.Error).toBe(0);
    // ...
  });
});
```

**lsp-convert.test.ts pattern** (adapts types.test.ts lines 65-78 — testing numeric values):
```typescript
import { describe, it, expect } from 'vitest';
import { toLspSeverity, toLspCompletionKind, toLspDiagnostic, toLspHover, toLspCompletionItem, toLspSignatureHelp } from '../lsp-convert.js';
import { LsSeverity, LsCompletionItemKind } from '@airtable-formula/language-services';

describe('lsp-convert', () => {
  it('toLspSeverity applies +1 offset for all 4 severity levels', () => {
    expect(toLspSeverity(LsSeverity.Error)).toBe(1);       // DiagnosticSeverity.Error
    expect(toLspSeverity(LsSeverity.Warning)).toBe(2);
    expect(toLspSeverity(LsSeverity.Information)).toBe(3);
    expect(toLspSeverity(LsSeverity.Hint)).toBe(4);
  });
  it('toLspCompletionKind applies +1 offset for all 25 kind values', () => {
    expect(toLspCompletionKind(LsCompletionItemKind.Text)).toBe(1);
    expect(toLspCompletionKind(LsCompletionItemKind.Function)).toBe(3);
    expect(toLspCompletionKind(LsCompletionItemKind.TypeParameter)).toBe(25);
  });
});
```

**router.test.ts pattern** (simple lookup assertions, same shape as types.test.ts):
```typescript
import { describe, it, expect } from 'vitest';
import { routeDocument } from '../router.js';

describe('routeDocument', () => {
  it('routes by language ID first', () => {
    expect(routeDocument('file:///foo.txt', 'airtable-formula')).toBe('formula');
  });
  it('falls back to file extension', () => {
    expect(routeDocument('file:///foo.formula', undefined)).toBe('formula');
    expect(routeDocument('file:///bar.ats', undefined)).toBe('script');
  });
  it('returns null for unknown extension', () => {
    expect(routeDocument('file:///foo.js', undefined)).toBeNull();
  });
});
```

---

### `packages/mcp-server/src/daemon/launcher.js` (modified)

**Modification target:** Add LSP subprocess spawn after `syncLockfile()` at line 329.

**`spawnDetachedDaemon` spawn pattern** (launcher.js lines 453-474 — adapt for tracked, non-detached child):
```javascript
// spawnDetachedDaemon (lines 453-474) — DETACHED pattern (do NOT copy detached:true):
const child = spawn(process.execPath, args, {
  detached: true,   // <-- NOT wanted for LSP child (daemon must hold ref for SIGTERM)
  stdio: 'ignore',
  env: { ...env, AIRTABLE_USER_MCP_HOME: configDir },
});
child.unref();  // <-- NOT wanted for LSP child

// LSP child pattern — TRACKED (held for SIGTERM on daemon shutdown):
const lspBin = resolveCliEntry();   // reuse existing resolveCliEntry() (lines 29-33)
// resolveCliEntry() resolves to the bundled binary — lsp-server must be bundled alongside or resolved via require.resolve
const lspChild = spawn(process.execPath, [lspBin_lsp, '--tcp'], {
  stdio: 'ignore',
  env: { ...process.env, AIRTABLE_USER_MCP_HOME: configDir },
  // No detached:true — daemon holds reference
});
// Hold lspChild for SIGTERM on finalize()
```

**finalize() / signalHandler pattern** (launcher.js lines 290-312 — add lspChild.kill to finalize):
```javascript
// Existing finalize() (lines 290-303):
const finalize = async () => {
  if (!finalizePromise) {
    finalizePromise = (async () => {
      // ...existing cleanup...
      release({ lockPath, expectedUuid: uuid });
      finalizeResolve?.();
    })();
  }
  await finalizePromise;
};
// Addition: lspChild?.kill('SIGTERM') before release()
```

**Poll loop pattern** (launcher.js lines 200-219, `ensureDaemon` polling — adapt for `port_lsp` poll):
```javascript
// ensureDaemon polls: (lines 200-219)
while (Date.now() < deadline) {
  const status = await getDaemonStatus({ ... });
  if (status.running && status.healthy) return toConnectionInfo(...);
  await delay(options.pollIntervalMs ?? 200);
}
// port_lsp poll adapts this: poll read({ lockPath }).port_lsp until non-null (timeout → proceed without LSP)
```

---

### `packages/mcp-server/src/daemon/server.js` (modified)

**Modification target:** Accept `lspChild` reference and send SIGTERM on shutdown.

**Shutdown step pattern** (server.js `runShutdownStep` + `stop()` lines 239-274):
```javascript
// server.js stop() pattern (lines 247-273):
const stop = async () => {
  if (closed) return;
  closed = true;
  await runShutdownStep('sse-clients', () => { /* ... */ });
  for (const cleanup of Array.from(activeMcpClosers)) {
    await runShutdownStep('mcp-cleanup', () => cleanup());
  }
  await runShutdownStep('on-shutdown', () => options.onShutdown?.() ?? undefined);
  // Addition: await runShutdownStep('lsp-child', () => { options.lspChild?.kill('SIGTERM'); });
  if (httpServer) { await runShutdownStep('http-close', () => new Promise((resolve, reject) => { ... })); }
};
```

---

### `.github/workflows/release.yml` (modified)

**Modification target:** Add `lsp-server` as a third target choice.

**MCP server bump block to duplicate** (release.yml lines 110-149):
```yaml
- name: Bump MCP server version    # → copy as "Bump LSP server version"
  id: mcp_version                   # → id: lsp_version
  if: inputs.target == 'mcp-server' || inputs.target == 'both'
                                    # → if: inputs.target == 'lsp-server'
  run: |
    PKG="packages/mcp-server/package.json"   # → packages/lsp-server/package.json
    PUBLISHED=$(npm view airtable-user-mcp version ...)  # → npm view airtable-user-lsp version
```

**MCP publish block to duplicate** (release.yml lines 203-210):
```yaml
- name: Publish MCP server to npm  # → "Publish LSP server to npm"
  if: "!inputs.dry_run && (inputs.target == 'mcp-server' || inputs.target == 'both')"
                                    # → inputs.target == 'lsp-server'
  working-directory: packages/mcp-server   # → packages/lsp-server
  run: npm publish --provenance --access public
```

**Commit/tag block additions** (release.yml lines 225-229):
```yaml
if [[ "${{ inputs.target }}" == "mcp-server" || "${{ inputs.target }}" == "both" ]]; then
  # → Add parallel block for lsp-server:
  git add packages/lsp-server/package.json
  TARGETS="${TARGETS} lsp-server v${{ steps.lsp_version.outputs.next }}"
  TAGS="${TAGS} lsp-server/v${{ steps.lsp_version.outputs.next }}"
fi
```

**GitHub release block to duplicate** (release.yml lines 257-266):
```yaml
- name: Create MCP server GitHub Release  # → "Create LSP server GitHub Release"
  if: "!inputs.dry_run && (inputs.target == 'mcp-server' || inputs.target == 'both')"
  run: |
    gh release create "mcp-server/v..."   # → "lsp-server/v..."
      --title "MCP Server v..."           # → "LSP Server v..."
```

**`inputs.target` choices addition** (release.yml line 10-12):
```yaml
options:
  - extension
  - mcp-server
  - lsp-server    # new
  - both
```

---

## Shared Patterns

### Language ID routing
**Source:** `packages/extension/src/language/registration.ts` lines 20-127
**Apply to:** `router.ts` — the three language IDs (`airtable-formula`, `airtable-script`, `airtable-automation`) are the authoritative strings. The file extension fallbacks (`.formula`, `.fx`, `.ats`, `.script`, `.ata`, `.automation`) supplement — same IDs confirmed in registration.ts.

### Atomic lockfile write (write-file-to-tmp + rename)
**Source:** `packages/mcp-server/src/daemon/lockfile.js` lines 119-123
**Apply to:** `lockfile-writer.ts` — always `writeFileSync(tmpPath) + renameSync(tmp, lock)`. Never write directly to the lock path.

### Signal handler cleanup pattern
**Source:** `packages/mcp-server/src/daemon/launcher.js` lines 305-313
**Apply to:** `launcher.js` modification — the `process.off('SIGINT', signalHandler) + process.off('SIGTERM', signalHandler)` in `finalize()` is the existing pattern. Add `lspChild?.kill('SIGTERM')` before `release()` in the same `finalizePromise` block.

### Env var config dir resolution
**Source:** `packages/mcp-server/src/daemon/launcher.js` line 460 (`AIRTABLE_USER_MCP_HOME: configDir` in spawn env)
**Apply to:** `tcp-server.ts`, `index.ts` — LSP server reads `AIRTABLE_USER_MCP_HOME` env var to find the config dir and derive the lockfile path. The daemon already passes this env var to spawned processes (confirmed in `spawnDetachedDaemon` line 469).

### ESM workspace package import
**Source:** `packages/language-services/package.json` line 3 (`"type": "module"`) + line 19 (`devDependencies`)
**Apply to:** `lsp-server/package.json` — `"type": "module"` required; `language-services` in `devDependencies` (bundled, not runtime).

### Test import pattern (`.js` extensions)
**Source:** `packages/language-services/src/test/types.test.ts` lines 8-12
**Apply to:** All test files — use `.js` extension in relative imports even from `.ts` source files (ESM TypeScript convention used throughout the project):
```typescript
import { routeDocument } from '../router.js';  // not '../router.ts'
import { toLspSeverity } from '../lsp-convert.js';
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/lsp-server/src/server.ts` LSP connection handlers (`onCompletion`, `onHover`, `onSignatureHelp`) | service | event-driven | No existing LSP server in codebase. The VS Code extension uses `vscode.languages.register*Provider` API (completely different protocol). Use RESEARCH.md Patterns 1, 4, 6 for `vscode-languageserver/node` API. |
| `packages/lsp-server/src/tcp-server.ts` per-socket `createConnection(reader, writer)` | service | event-driven | No multi-client TCP LSP server in codebase. Use RESEARCH.md Pattern 2 (`net.createServer` + `StreamMessageReader`/`StreamMessageWriter`). |

---

## Metadata

**Analog search scope:** `packages/extension/src/language/`, `packages/mcp-server/src/daemon/`, `packages/language-services/src/`, `packages/language-services/src/test/`, `.github/workflows/`
**Files scanned:** 12 source files read in full
**Pattern extraction date:** 2026-05-14
