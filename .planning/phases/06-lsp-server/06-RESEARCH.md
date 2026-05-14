# Phase 6: LSP Server - Research

**Researched:** 2026-05-14
**Domain:** LSP protocol (vscode-languageserver-node), Node.js TCP server, pnpm workspace publishing
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** New workspace package `packages/lsp-server/`, published as `airtable-user-lsp` (unscoped npm). Includes own README. Independent semver added to `release.yml`.
- **D-02:** Daemon spawns `airtable-user-lsp --tcp` as a managed subprocess. LSP writes `port_lsp` to `daemon.lock` itself. Daemon polls lockfile until `port_lsp` appears. Daemon sends SIGTERM to LSP child on shutdown.
- **D-03:** `language-services` stays private. Bundled into `airtable-user-lsp` dist at build time. Self-contained npm publish. No external `language-services` dep.
- **D-04:** `npx airtable-user-lsp --stdio` always starts fresh in-process. NO stdio-to-TCP proxy. External editors attach to TCP port by reading `port_lsp` from lockfile directly.
- **D-05:** VS Code extension providers unchanged. No LSP client in extension.
- **D-06:** `lsp-convert.ts` in `packages/lsp-server/src/` maps `Ls*` → `vscode-languageserver` protocol values. `language-services` stays LSP-clean.
- **D-07:** Routing — language ID first (`textDocument/didOpen` languageId), fallback to file extension. Map: `airtable-formula` / `.formula` / `.fx` → formula; `airtable-script` / `.ats` / `.script` → script; `airtable-automation` / `.ata` / `.automation` → automation.
- **D-08:** Include `textDocument/signatureHelp` (formula engine only — script and automation have no signature implementation).

### Claude's Discretion

- LSP subprocess shutdown: daemon sends SIGTERM (holds child process ref).
- TCP port assignment: OS assigns (bind on port 0, read back assigned port).
- `workspace/didChangeConfiguration` out of scope for Phase 6.

### Deferred Ideas (OUT OF SCOPE)

- `workspace/didChangeConfiguration` support (LSP-ADV-01)
- LSP code actions (LSP-ADV-02)
- Setup Tab LSP config snippets (UI-03, Phase 8)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LSP-01 | `airtable-user-lsp` npm package publicly installable via `npx airtable-user-lsp --stdio` | Package structure, bin entry, tsup bundling with language-services |
| LSP-02 | LSP server provides diagnostics, completions, hover for `.formula`, `.ats`, `.ata` files | vscode-languageserver protocol handlers, lsp-convert.ts conversion tables |
| LSP-03 | LSP server runs standalone (no daemon required) in stdio mode | `createConnection(ProposedFeatures.all)` reads `--stdio` from argv |
| LSP-04 | When daemon is running, LSP clients attach to `port_lsp` TCP port | Multi-client TCP server via raw `net.createServer` + `createConnection(reader, writer)` |
| LSP-05 | Daemon lockfile includes `port_lsp` field for client discovery | `lockfile.js` `replace()` with updated record — already has `port_lsp: null` in schema |

</phase_requirements>

---

## Summary

Phase 6 creates `packages/lsp-server/` — a new pnpm workspace package published as `airtable-user-lsp`. It wraps the three `language-services` engines behind the LSP protocol using `vscode-languageserver/node` 9.0.1 and `vscode-languageserver-textdocument` 1.0.12. All `language-services` source is bundled into the dist output at build time via tsup so the published package is self-contained.

The core technical challenge is the dual-mode entry point: `--stdio` creates one standard `createConnection(ProposedFeatures.all)` per invocation; `--tcp` creates a raw `net.Server` on port 0, calls `server.address().port` to get the assigned port, writes it to `daemon.lock` via `lockfile.js replace()`, and accepts multiple concurrent LSP connections (each wrapping socket streams in `createConnection(reader, writer)`). The critical insight is that `createClientSocketTransport` from vscode-jsonrpc is one-connection-only and not usable here — the TCP server must use raw `net.createServer`.

The type conversion layer (`lsp-convert.ts`) requires non-trivial numeric remapping: `LsSeverity` uses 0-based values mirroring VS Code but LSP protocol uses 1-based `DiagnosticSeverity`; `LsCompletionItemKind` uses 0-based VS Code values but LSP protocol uses 1-based `CompletionItemKind`. These offsets are verified against the official vscode-languageserver-types source.

**Primary recommendation:** Use `vscode-languageserver/node` 9.0.1 with `TextDocuments<TextDocument>` for document sync, raw `net.createServer` for multi-client TCP mode, and tsup with `noExternal: ['@airtable-formula/language-services']` for bundling.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| LSP stdio server | lsp-server process | — | Entry point binary, one process per editor session |
| LSP TCP server (multi-client) | lsp-server process (daemon-spawned) | daemon (lifecycle mgmt) | Each socket connection gets its own `Connection` instance; daemon only spawns/kills |
| Language intelligence | language-services (bundled) | — | All three engines live in lsp-server dist after bundling |
| Protocol type conversion | lsp-convert.ts | — | Bridges LsXxx (0-based) to LSP protocol (1-based) |
| lockfile port_lsp write | lsp-server (--tcp mode) | — | LSP process owns its own port_lsp field; daemon polls |
| Daemon subprocess spawn | daemon launcher.js | — | Adds `airtable-user-lsp --tcp` to `startDaemon()` |
| Document store | TextDocuments (vscode-languageserver) | — | Built-in; handles didOpen/didChange/didClose |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vscode-languageserver | 9.0.1 | LSP server API — `createConnection`, `TextDocuments`, all protocol handlers | Official Microsoft LSP implementation for Node; used by virtually all Node LSP servers |
| vscode-languageserver-textdocument | 1.0.12 | `TextDocument` class for document content management with `TextDocument.update()` for incremental sync | Required companion; provides `offsetAt`, `positionAt`, incremental change application |
| vscode-languageserver-protocol | 3.17.5 | Transitive dep via vscode-languageserver; provides `DiagnosticSeverity`, `CompletionItemKind` enums | Pulled automatically, but useful to reference for numeric values |

[VERIFIED: npm registry] — all three versions confirmed latest stable as of 2026-05-14.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsup | ^8.0.0 | Bundle lsp-server + language-services into self-contained ESM | Same tool already used for language-services build |
| vitest | ^1.6.0 | Unit tests for lsp-convert.ts and server logic | Same tool used by language-services; no new tooling needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vscode-languageserver | vscode-jsonrpc directly | vscode-languageserver adds TextDocuments manager and typed LSP handlers on top of vscode-jsonrpc; use vscode-languageserver for LSP servers |
| tsup bundle | esbuild directly (bundle-lsp.mjs) | Either works; tsup is simpler for a TypeScript source package; esbuild used for mcp-server because mcp-server is .js source |

**Installation:**
```bash
pnpm add --filter lsp-server vscode-languageserver vscode-languageserver-textdocument
pnpm add --filter lsp-server -D tsup typescript vitest
```

---

## Architecture Patterns

### System Architecture Diagram

```
[Editor / LSP Client]
       |                         [Daemon Process]
       | --stdio                       |
       v                           spawns
[airtable-user-lsp --stdio]    airtable-user-lsp --tcp
       |                               |
  createConnection(ProposedFeatures)   |  net.createServer(port 0)
       |                               |  server.address().port  →  port_lsp
       |                               |  lockfile.replace({ port_lsp })
       |                               |
       |   TextDocuments<TextDocument> |  [per-connection]
       |       onDidChangeContent      |  net.socket
       |              |                |  StreamMessageReader/Writer
       |              v                |  createConnection(reader, writer)
       |    routeByLanguageId()        |        |
       |     ├─ formula engine         |   (same handlers cloned per conn)
       |     ├─ script engine          |
       |     └─ automation engine      |
       |              |                |
       |         lsp-convert.ts        |
       |  LsXxx → LSP protocol types   |
       |              |                |
       |  connection.sendDiagnostics() |
       |  return CompletionItem[]      |
       v                               v
[LSP response to editor]     [LSP response to editor (per socket)]
```

### Recommended Project Structure

```
packages/lsp-server/
├── src/
│   ├── index.ts          # bin entry: parse --stdio / --tcp, start server
│   ├── server.ts         # createLspServer(connection): registers all handlers
│   ├── lsp-convert.ts    # LsXxx → LSP protocol type conversions
│   ├── router.ts         # routeByLanguageId(uri, langId): returns engine name
│   └── tcp-server.ts     # startTcpServer(): net.createServer, port 0, write port_lsp
├── test/
│   ├── lsp-convert.test.ts   # Wave 0: verify all enum mappings
│   └── router.test.ts        # Wave 0: verify language routing
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

### Pattern 1: Single stdio connection (LSP-03)

**What:** Standard stdio LSP server — one process per editor invocation.
**When to use:** `--stdio` flag (or no flag) in the entry point.

```typescript
// Source: Context7 /microsoft/vscode-languageserver-node
import { createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
// createConnection reads --stdio / --node-ipc / --socket=PORT from process.argv automatically
// When launched as `airtable-user-lsp --stdio`, argv contains --stdio → stdio transport

const documents = new TextDocuments(TextDocument);

connection.onInitialize((_params) => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { resolveProvider: false, triggerCharacters: ['(', ',', '{', "'", '"', '.'] },
    hoverProvider: true,
    signatureHelpProvider: { triggerCharacters: ['(', ','] },
  },
}));

documents.onDidChangeContent(change => validate(change.document, connection));
documents.listen(connection);
connection.listen();
```

### Pattern 2: Multi-client TCP server (LSP-04)

**What:** A `net.Server` listening on port 0, accepting multiple simultaneous LSP connections. Each accepted socket gets its own independent `createConnection(reader, writer)` instance.
**When to use:** `--tcp` flag — spawned by daemon `startDaemon()`.

**Critical finding:** `createClientSocketTransport` from vscode-jsonrpc is designed for one-connection-only (calls `server.close()` after first accept). Do NOT use it for multi-client daemon mode. Use raw `net.createServer` directly. [VERIFIED: vscode-languageserver-node source, github.com/microsoft/vscode-languageserver-node/blob/main/jsonrpc/src/node/main.ts]

```typescript
// Source: Context7 /microsoft/vscode-languageserver-node (adapted for multi-client)
import * as net from 'net';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';

export async function startTcpServer(lockfilePath: string): Promise<net.Server> {
  const tcpServer = net.createServer((socket) => {
    const reader = new StreamMessageReader(socket);
    const writer = new StreamMessageWriter(socket);
    const connection = createConnection(ProposedFeatures.all, reader, writer);
    registerHandlers(connection);   // same handler-registration function as stdio mode
    connection.listen();
    socket.on('close', () => connection.dispose());
  });

  await new Promise<void>((resolve, reject) => {
    tcpServer.once('error', reject);
    tcpServer.listen(0, '127.0.0.1', () => {
      tcpServer.removeListener('error', reject);
      resolve();
    });
  });

  const assignedPort = (tcpServer.address() as net.AddressInfo).port;

  // Write port_lsp to daemon.lock using lockfile.js replace()
  const record = readLockfile(lockfilePath);
  replaceLockfile({ ...record, port_lsp: assignedPort }, { lockPath: lockfilePath });

  return tcpServer;
}
```

**Port 0 pattern:** `net.Server.listen(0, ...)` asks the OS to assign a free port. After the `listening` event, `server.address().port` returns the actual port. [VERIFIED: Node.js docs, standard pattern]

### Pattern 3: lsp-convert.ts — type conversion

**What:** Maps `Ls*` (0-based VS Code parity values) to LSP protocol values (1-based).
**Why it's non-trivial:** The offset between the two enum families is exactly +1 for both `DiagnosticSeverity` and `CompletionItemKind`, BUT the ordering must match exactly.

```typescript
// Source: VERIFIED against github.com/microsoft/vscode-languageserver-node/blob/main/types/src/main.ts
// and packages/language-services/src/types.ts (codebase)

import {
  DiagnosticSeverity, CompletionItemKind, Diagnostic, CompletionItem,
  Hover, SignatureHelp, SignatureInformation, ParameterInformation,
  Range, Position
} from 'vscode-languageserver-types';
import { LsSeverity, LsCompletionItemKind } from '@airtable-formula/language-services';
import type { LsDiagnostic, LsCompletionItem, LsHover, LsSignatureHelp } from '@airtable-formula/language-services';

// LsSeverity (mirrors vscode) → LSP DiagnosticSeverity
// LsSeverity.Error = 0        →  DiagnosticSeverity.Error = 1    (+1)
// LsSeverity.Warning = 1      →  DiagnosticSeverity.Warning = 2  (+1)
// LsSeverity.Information = 2  →  DiagnosticSeverity.Information = 3  (+1)
// LsSeverity.Hint = 3         →  DiagnosticSeverity.Hint = 4     (+1)
export function toLspSeverity(s: LsSeverity): DiagnosticSeverity {
  return (s + 1) as DiagnosticSeverity;  // simple +1 offset
}

// LsCompletionItemKind (mirrors vscode, 0-based) → LSP CompletionItemKind (1-based)
// LsCompletionItemKind.Text = 0       →  CompletionItemKind.Text = 1       (+1)
// LsCompletionItemKind.Method = 1     →  CompletionItemKind.Method = 2     (+1)
// LsCompletionItemKind.Function = 2   →  CompletionItemKind.Function = 3   (+1)
// ... all 25 members follow the same +1 offset
export function toLspCompletionKind(k: LsCompletionItemKind): CompletionItemKind {
  return (k + 1) as CompletionItemKind;  // simple +1 offset; valid for all 25 members
}

export function toLspDiagnostic(d: LsDiagnostic): Diagnostic {
  const diag = Diagnostic.create(
    Range.create(d.range.start.line, d.range.start.character,
                 d.range.end.line, d.range.end.character),
    d.message,
    toLspSeverity(d.severity),
    d.code,
    d.source
  );
  if (d.relatedInformation) {
    diag.relatedInformation = d.relatedInformation.map(ri => ({
      location: { uri: ri.location.uri, range: Range.create(
        ri.location.range.start.line, ri.location.range.start.character,
        ri.location.range.end.line, ri.location.range.end.character
      )},
      message: ri.message,
    }));
  }
  return diag;
}

export function toLspCompletionItem(item: LsCompletionItem): CompletionItem {
  const ci: CompletionItem = { label: item.label };
  if (item.kind !== undefined) ci.kind = toLspCompletionKind(item.kind);
  if (item.detail !== undefined) ci.detail = item.detail;
  if (item.documentation !== undefined) {
    ci.documentation = typeof item.documentation === 'string'
      ? item.documentation
      : { kind: 'markdown', value: item.documentation.value };
  }
  if (item.insertText !== undefined) ci.insertText = item.insertText;
  if (item.filterText !== undefined) ci.filterText = item.filterText;
  if (item.sortText !== undefined) ci.sortText = item.sortText;
  return ci;
}

export function toLspHover(h: LsHover): Hover {
  return {
    contents: { kind: h.contents.kind === 'markdown' ? 'markdown' : 'plaintext', value: h.contents.value },
    range: h.range ? Range.create(h.range.start.line, h.range.start.character,
                                   h.range.end.line, h.range.end.character) : undefined,
  };
}

export function toLspSignatureHelp(sh: LsSignatureHelp): SignatureHelp {
  return {
    signatures: sh.signatures.map(sig => ({
      label: sig.label,
      documentation: sig.documentation ? { kind: 'markdown', value: sig.documentation } : undefined,
      parameters: sig.parameters.map(p => ParameterInformation.create(p.label, p.documentation)),
    } as SignatureInformation)),
    activeSignature: sh.activeSignature,
    activeParameter: sh.activeParameter,
  };
}
```

### Pattern 4: LSP Capability Registration

**What:** `onInitialize` returns `InitializeResult` declaring all capabilities.
**Note:** `signatureHelpProvider` is formula-engine-only per D-08. The trigger characters `(` and `,` match existing extension registration.

```typescript
// Source: Context7 /microsoft/vscode-languageserver-node
connection.onInitialize((_params: InitializeParams): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: {
      resolveProvider: false,
      triggerCharacters: ['(', '{', "'", '"', '.'],
    },
    hoverProvider: true,
    signatureHelpProvider: {
      triggerCharacters: ['(', ','],
    },
    // diagnosticProvider omitted — we use push-based sendDiagnostics, not pull-based
  },
}));
```

**Push vs pull diagnostics:** Use `connection.sendDiagnostics()` (push, triggered by `documents.onDidChangeContent`). Do NOT declare `diagnosticProvider` capability — that enables pull-based diagnostics (a newer pattern requiring `textDocument/diagnostic` request handling). Push-based is simpler and universally supported. [ASSUMED — based on common practice and the fact that the existing extension uses push-based. Pull-based exists in LSP 3.17 but not universally supported by all editors.]

### Pattern 5: Language Router

**What:** Determines which engine to call based on `textDocument.uri` and `textDocument.languageId`.

```typescript
// Derived from D-07 decisions; no external library needed
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

function routeDocument(uri: string, languageId?: string): string | null {
  if (languageId && LANG_TO_ENGINE[languageId]) return LANG_TO_ENGINE[languageId];
  const ext = path.extname(new URL(uri).pathname);
  return EXT_TO_ENGINE[ext] ?? null;
}
```

### Pattern 6: Document store per connection (TextDocuments)

**What:** `TextDocuments<TextDocument>` is instantiated once per `Connection` and calls `documents.listen(connection)`. In TCP mode with multiple connections, each connection needs its own `TextDocuments` instance (document state is per-client).

```typescript
// Per-connection factory — called for both stdio and each TCP socket
function registerHandlers(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);

  documents.onDidChangeContent(change => {
    const engine = routeDocument(change.document.uri, change.document.languageId);
    if (!engine) {
      connection.sendDiagnostics({ uri: change.document.uri, diagnostics: [] });
      return;
    }
    const lsDiags = runEngine(engine, change.document.getText(), change.document.uri);
    connection.sendDiagnostics({
      uri: change.document.uri,
      diagnostics: lsDiags.map(toLspDiagnostic),
    });
  });

  documents.onDidClose(e => {
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  connection.onCompletion(params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const engine = routeDocument(doc.uri, doc.languageId);
    if (!engine) return [];
    const items = runEngineCompletions(engine, doc.getText(), params.position);
    return items.map(toLspCompletionItem);
  });

  connection.onHover(params => { /* ... */ });
  connection.onSignatureHelp(params => { /* formula only */ });

  documents.listen(connection);
}
```

### Pattern 7: Package.json bin for `npx` invocation

```json
{
  "name": "airtable-user-lsp",
  "version": "1.0.0",
  "type": "module",
  "bin": { "airtable-user-lsp": "dist/index.mjs" },
  "engines": { "node": ">=20" },
  "files": ["dist/**", "README.md", "LICENSE"],
  "publishConfig": { "access": "public", "provenance": true }
}
```

**Entry point routing in index.ts:**
```typescript
const mode = process.argv.includes('--tcp') ? 'tcp' : 'stdio';
if (mode === 'tcp') {
  await startTcpServer();  // binds port 0, writes port_lsp to lockfile
} else {
  startStdioServer();      // createConnection reads --stdio from argv
}
```

### Anti-Patterns to Avoid

- **Using `createClientSocketTransport` for multi-client:** It calls `server.close()` after the first connection. Use `net.createServer` directly.
- **Hardcoding a TCP port:** `--tcp` must use port 0 (OS-assigned) per D-02 decision. Reading back via `server.address().port` is the only correct approach.
- **Sharing a single `TextDocuments` instance across TCP connections:** Each LSP connection has independent document state; a `TextDocuments` instance is bound to one `Connection`. Instantiate one `TextDocuments` per connection.
- **Declaring `diagnosticProvider` capability:** This enables pull-based diagnostics (LSP 3.17 textDocument/diagnostic). Use push-based `sendDiagnostics` instead — simpler and compatible with all editors.
- **Calling language-services before bundling is wired:** The tsup build must include `@airtable-formula/language-services` in the bundle (`noExternal` config) or the published package will have an unsatisfied peer dependency.
- **Writing port_lsp before the net.Server `listening` event fires:** `server.address()` returns `null` until the `listening` event. Always await the callback/promise before reading the port.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Document content management (open/change/close tracking) | Custom URI → text map | `TextDocuments<TextDocument>` from vscode-languageserver | Handles incremental sync, version tracking, encoding — all the edge cases |
| LSP JSON-RPC framing | Custom `Content-Length:` header parser/writer | `createConnection` / `StreamMessageReader` / `StreamMessageWriter` | LSP framing has subtle edge cases; official impl handles partial reads, backpressure |
| Enum value tables | Handwritten numeric conversion maps | Simple arithmetic (+1 offset for both enums, verified) | The +1 offset is confirmed and constant; a lookup table is overkill |
| TCP server lifecycle | Custom polling loop to check if port is bound | Node.js `listening` event on `net.Server` | Standard event-driven pattern; polling adds latency and race conditions |
| LSP capability negotiation | Manual capability version checks | `ProposedFeatures.all` + standard capability objects | The library handles negotiation internally |

**Key insight:** `TextDocuments` alone saves several hundred lines of correct document-sync implementation. The LSP document sync protocol has version tracking, incremental change application, and encoding concerns that are all handled correctly by the official library.

---

## Common Pitfalls

### Pitfall 1: LsCompletionItemKind offset confusion

**What goes wrong:** Returning completions with wrong kind icons in editors.
**Why it happens:** `LsCompletionItemKind.Text = 0` but `CompletionItemKind.Text = 1`. If the Ls value is passed directly as the LSP kind, every item shifts one category (a `Function` item appears as `Method`).
**How to avoid:** Always call `toLspCompletionKind(item.kind)` — never pass `item.kind` directly to the LSP response.
**Warning signs:** Completion items show wrong icons; `Function` (kind=3 expected) shows as `Method` (kind=2) in editor UI.

### Pitfall 2: LsSeverity offset

**What goes wrong:** Diagnostics show with wrong severity in the editor.
**Why it happens:** `LsSeverity.Error = 0` but `DiagnosticSeverity.Error = 1`. Passing Ls value directly → all errors become Hints.
**How to avoid:** Call `toLspSeverity(d.severity)` — apply the +1 offset.
**Warning signs:** Errors show as Info/Hint squiggles instead of red underlines.

### Pitfall 3: TCP port_lsp race condition

**What goes wrong:** Daemon polls lockfile but `port_lsp` stays null or reads stale data.
**Why it happens:** LSP server writes `port_lsp` to lockfile before `net.Server` has actually bound.
**How to avoid:** Write `port_lsp` only inside the `server.listen(0, '127.0.0.1', callback)` callback (or in the `listening` event handler), never before. Verify with `server.address() !== null` check.
**Warning signs:** Daemon times out waiting for `port_lsp`; intermittent failure on slow machines.

### Pitfall 4: Stale diagnostics after file close

**What goes wrong:** Diagnostics persist in editor after file is closed.
**Why it happens:** Missing `documents.onDidClose` handler that sends empty diagnostics array.
**How to avoid:** Always implement `documents.onDidClose(e => connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] }))`.
**Warning signs:** Editor shows diagnostics for files that are no longer open.

### Pitfall 5: Single TextDocuments instance shared across TCP connections

**What goes wrong:** Document changes in one editor session affect diagnostics in another.
**Why it happens:** `TextDocuments` stores an in-memory map of URI → document; sharing it across connections would merge document state from different editors.
**How to avoid:** Instantiate `new TextDocuments(TextDocument)` inside the per-connection factory function, not at module level.
**Warning signs:** Editor A opens `/foo.formula`; editor B sees different content than what it opened.

### Pitfall 6: tsup ESM output with language-services bundling

**What goes wrong:** `import` of `@airtable-formula/language-services` fails at runtime because it's not included in the bundle.
**Why it happens:** tsup marks workspace dependencies as external by default unless told otherwise.
**How to avoid:** Use `noExternal: ['@airtable-formula/language-services']` in tsup.config.ts so it bundles the private workspace package into dist.
**Warning signs:** `ERR_MODULE_NOT_FOUND` when running `npx airtable-user-lsp` outside the monorepo.

### Pitfall 7: Missing `--stdio` argv when editors don't pass it

**What goes wrong:** `createConnection(ProposedFeatures.all)` cannot determine transport and throws or hangs.
**Why it happens:** Some editors invoke the LSP server binary without `--stdio` — they assume stdio is the default.
**How to avoid:** In `index.ts`, when mode is 'stdio' (no `--tcp` arg), inject `--stdio` into `process.argv` if it's not already present before calling `createConnection`, OR pass `process.stdin`/`process.stdout` explicitly as streams.
**Warning signs:** LSP server hangs on startup when invoked by certain editors.

---

## Complete Enum Conversion Tables

### LsSeverity → LSP DiagnosticSeverity

[VERIFIED: `packages/language-services/src/types.ts` (codebase) + `github.com/microsoft/vscode-languageserver-node/blob/main/types/src/main.ts`]

| LsSeverity value | LsSeverity name | LSP DiagnosticSeverity name | LSP value | Conversion |
|-----------------|-----------------|----------------------------|-----------|-----------|
| 0 | Error | Error | 1 | +1 |
| 1 | Warning | Warning | 2 | +1 |
| 2 | Information | Information | 3 | +1 |
| 3 | Hint | Hint | 4 | +1 |

**Formula:** `lspSeverity = lsSeverity + 1`

### LsCompletionItemKind → LSP CompletionItemKind

[VERIFIED: `packages/language-services/src/types.ts` (codebase, annotated "mirrors vscode.CompletionItemKind exactly") + `github.com/microsoft/vscode-languageserver-node/blob/main/types/src/main.ts`]

| LsCompletionItemKind value | Name | LSP CompletionItemKind value | Conversion |
|---------------------------|------|------------------------------|-----------|
| 0 | Text | 1 | +1 |
| 1 | Method | 2 | +1 |
| 2 | Function | 3 | +1 |
| 3 | Constructor | 4 | +1 |
| 4 | Field | 5 | +1 |
| 5 | Variable | 6 | +1 |
| 6 | Class | 7 | +1 |
| 7 | Interface | 8 | +1 |
| 8 | Module | 9 | +1 |
| 9 | Property | 10 | +1 |
| 10 | Unit | 11 | +1 |
| 11 | Value | 12 | +1 |
| 12 | Enum | 13 | +1 |
| 13 | Keyword | 14 | +1 |
| 14 | Snippet | 15 | +1 |
| 15 | Color | 16 | +1 |
| 16 | File | 17 | +1 |
| 17 | Reference | 18 | +1 |
| 18 | Folder | 19 | +1 |
| 19 | EnumMember | 20 | +1 |
| 20 | Constant | 21 | +1 |
| 21 | Struct | 22 | +1 |
| 22 | Event | 23 | +1 |
| 23 | Operator | 24 | +1 |
| 24 | TypeParameter | 25 | +1 |

**Formula:** `lspKind = lsKind + 1` — uniform across all 25 members.

---

## Build and Release Patterns

### tsup.config.ts for lsp-server

Language-services uses `"private": true` — it cannot be published. tsup must bundle it into the lsp-server output. The `noExternal` option forces tsup to include workspace dependencies in the bundle. [VERIFIED: tsup docs + language-services package.json `"private": true`]

```typescript
// packages/lsp-server/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  target: 'node20',
  platform: 'node',
  bundle: true,
  noExternal: ['@airtable-formula/language-services'],  // bundle private workspace dep
  external: [],  // no external deps for the published package
  dts: false,    // no type declarations needed for a CLI binary
  clean: true,
  outDir: 'dist',
});
```

### package.json structure for lsp-server

Mirrors `airtable-user-mcp/package.json` structure exactly per D-01:

```json
{
  "name": "airtable-user-lsp",
  "version": "1.0.0",
  "description": "Airtable language server for formula, script, and automation files. Works with any LSP-capable editor.",
  "type": "module",
  "main": "dist/index.mjs",
  "bin": { "airtable-user-lsp": "dist/index.mjs" },
  "engines": { "node": ">=20" },
  "files": ["dist/**", "README.md", "LICENSE"],
  "publishConfig": { "access": "public", "provenance": true },
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

**Key nuance:** `language-services` is in `devDependencies` (not `dependencies`) because it is bundled at build time — not needed at runtime by the published package. [ASSUMED based on tsup bundling behavior — needs validation that tsup resolves devDependencies for bundling. The alternative is to put it in `dependencies` and use `noExternal` to bundle it anyway.]

### Release workflow additions

The release.yml needs a new `lsp-server` target. Pattern is identical to the `mcp-server` target block (npm publish with provenance, version bump query from npm registry, tag as `lsp-server/v{version}`):

```yaml
# Add to inputs.target options:
options:
  - extension
  - mcp-server
  - lsp-server     # new
  - both

# Add version bump step:
- name: Bump LSP server version
  id: lsp_version
  if: inputs.target == 'lsp-server'
  run: |
    PKG="packages/lsp-server/package.json"
    PUBLISHED=$(npm view airtable-user-lsp version 2>/dev/null || echo "0.0.0")
    # ... same pattern as mcp-server bump step ...

# Add publish step:
- name: Publish LSP server to npm
  if: "!inputs.dry_run && inputs.target == 'lsp-server'"
  working-directory: packages/lsp-server
  run: npm publish --provenance --access public
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Daemon launcher.js additions

`startDaemon()` in `packages/mcp-server/src/daemon/launcher.js` currently sets `port_lsp: null` in the lockfile record (confirmed in existing code, line 279). Phase 6 adds LSP subprocess spawn after the MCP server binds. Pattern mirrors `spawnDetachedDaemon` but spawns `airtable-user-lsp --tcp` as a tracked (not detached) child:

```javascript
// In startDaemon(), after syncLockfile():
const lspChild = spawn(process.execPath, ['--input-type=module', '-e',
  `import { startTcpServer } from 'airtable-user-lsp'; await startTcpServer('${lockPath}');`
], { stdio: 'ignore', env: { ...process.env, AIRTABLE_USER_MCP_HOME: configDir } });
// OR (simpler):
const lspBin = resolveCliEntry('airtable-user-lsp');
const lspChild = spawn(process.execPath, [lspBin, '--tcp', '--lockfile', lockPath], {
  stdio: 'ignore',
  env: { ...process.env, AIRTABLE_USER_MCP_HOME: configDir }
});
// Hold reference for SIGTERM on daemon shutdown
```

[ASSUMED — the exact spawn invocation depends on how `airtable-user-lsp` resolves in the daemon's runtime context (bundled alongside daemon or a separate npm install). The planner needs to decide: (A) spawn via `npx airtable-user-lsp --tcp`, (B) spawn via a bundled copy, or (C) import and call in-process. Option C is simplest but makes the daemon depend on lsp-server.]

---

## Integration with Existing Daemon Files

### Files to modify in mcp-server (Phase 5 files, already exist)

| File | Change | Pattern |
|------|--------|---------|
| `packages/mcp-server/src/daemon/launcher.js` | Add LSP subprocess spawn in `startDaemon()`, hold `lspChild` ref, poll lockfile for `port_lsp`, SIGTERM on shutdown | Spawn pattern from `spawnDetachedDaemon`; tracked (not detached) |
| `packages/mcp-server/src/daemon/lockfile.js` | No changes needed — `port_lsp` field already present and normalized | Already confirmed in codebase |
| `packages/mcp-server/src/daemon/server.js` | If SIGTERM is sent from shutdown handler, needs reference to `lspChild` passed in | Parameter injection or module-level ref |

### lockfile.js `replace()` call from lsp-server

The LSP server subprocess writes its port via `replace()` imported from the daemon lockfile module. Since lsp-server is a separate package, it must either:
- Import `lockfile.js` from the daemon package (cross-package workspace import), OR
- Duplicate the minimal `replace()` logic in `lsp-server/src/lockfile-client.ts`

[ASSUMED — Option A (workspace import) is cleaner but requires `airtable-user-mcp` as a devDependency of lsp-server. Option B adds ~30 lines of duplication but keeps packages fully independent. Recommend discussing with user or planner.]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pull-based diagnostics (textDocument/diagnostic) | Push-based `connection.sendDiagnostics()` still standard | LSP 3.17 added pull-based | Push-based is still correct and simpler; pull-based optional |
| `vscode-languageserver` major churn between v8/v9 | v9.0.1 stable since 2023 | 2023 | API stable; no breaking changes expected |
| `activeSignature` / `activeParameter` breaking change | Now returned as nullable (both can be `undefined`) | Between v5 and v6 | Phase 6 uses v9 — follow v9 patterns; LsSignatureHelp already uses numbers not null |

**Deprecated/outdated:**
- `vscode-languageserver` v7 and below: Use v9.0.1.
- `createClientSocketTransport` for multi-client TCP: One-connection-only; use raw `net.createServer`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 20 | lsp-server runtime | Yes | v22.13.1 | — |
| pnpm | workspace package creation | Yes | 10.10.0 | — |
| npm registry | airtable-user-lsp publish | Yes | 11.12.1 | — |
| vscode-languageserver | new package dep | installable | 9.0.1 | — |
| vscode-languageserver-textdocument | new package dep | installable | 1.0.12 | — |

No missing dependencies.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^1.6.0 (same as language-services) |
| Config file | `packages/lsp-server/vitest.config.ts` — Wave 0 gap |
| Quick run command | `pnpm -F airtable-user-lsp test` |
| Full suite command | `pnpm -F airtable-user-lsp test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LSP-01 | Package structure correct (bin, files, type=module) | unit | `pnpm -F airtable-user-lsp test` (package.json shape test) | ❌ Wave 0 |
| LSP-02 | lsp-convert.ts all enum conversions correct | unit | `pnpm -F airtable-user-lsp test` (lsp-convert.test.ts) | ❌ Wave 0 |
| LSP-02 | Language router returns correct engine | unit | `pnpm -F airtable-user-lsp test` (router.test.ts) | ❌ Wave 0 |
| LSP-03 | stdio mode: completions/diagnostics/hover returned | integration | manual (`npx airtable-user-lsp --stdio` pipe test) | ❌ manual |
| LSP-04 | TCP mode: port_lsp written to lockfile | unit | `pnpm -F airtable-user-lsp test` (tcp-server.test.ts) | ❌ Wave 0 |
| LSP-05 | Lockfile port_lsp field present and positive integer | unit | `pnpm -F airtable-user-lsp test` (tcp-server.test.ts) | ❌ Wave 0 |

### Wave 0 Gaps

- [ ] `packages/lsp-server/vitest.config.ts` — test runner config
- [ ] `packages/lsp-server/src/test/lsp-convert.test.ts` — covers LSP-02 (all 4 severity mappings, all 25 kind mappings)
- [ ] `packages/lsp-server/src/test/router.test.ts` — covers LSP-02 (all language IDs, all file extensions, unknown returns null)
- [ ] `packages/lsp-server/src/test/tcp-server.test.ts` — covers LSP-04, LSP-05 (port_lsp written, port > 0)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | LSP is localhost-only, no auth needed |
| V3 Session Management | No | Stateless per-connection protocol |
| V4 Access Control | No | `127.0.0.1` bind only — not exposed to network |
| V5 Input Validation | Yes | Document URIs and language IDs from LSP clients | uri.pathname parsing only |
| V6 Cryptography | No | — |

### Known Threat Patterns for LSP TCP server

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Local port access by other processes | Elevation of Privilege | Bind to `127.0.0.1` only (not `0.0.0.0`); loopback-only |
| Malformed LSP JSON-RPC messages | Tampering | vscode-languageserver/jsonrpc handles framing; application code defensively checks `doc !== undefined` before use |
| Path traversal via malicious URI | Tampering | Never write to URIs; only read URI for routing (file extension check only) |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `language-services` as `devDependencies` + `noExternal` in tsup will correctly bundle it into the publishable dist | Build and Release Patterns | If tsup doesn't resolve devDependencies for bundling, must move to `dependencies`; low risk, easily validated |
| A2 | Push-based `sendDiagnostics` is the correct pattern (vs LSP 3.17 pull-based `diagnosticProvider`) | Pattern 1 / Architecture | All major LSP-capable editors support push-based; some newer editors may prefer pull-based — acceptable tradeoff for Phase 6 |
| A3 | The lockfile's `replace()` function can be imported by lsp-server (cross-package workspace import of mcp-server code) OR must be duplicated | Integration with Existing Daemon Files | If cross-package import of mcp-server (a .js ESM package) from lsp-server (a TypeScript package) causes build issues, must duplicate the ~30-line `replace()` function |
| A4 | `spawn(process.execPath, [lspBin, '--tcp', '--lockfile', lockPath])` is the correct spawn pattern from launcher.js | Daemon launcher.js additions | Depends on how lsp-server binary is resolvable at daemon runtime — needs planner decision on resolution strategy |

---

## Open Questions

1. **lockfile.js cross-package import strategy**
   - What we know: `lsp-server` needs to call `lockfile.replace()` to write `port_lsp`. `lockfile.js` lives in `packages/mcp-server/src/daemon/`.
   - What's unclear: Should lsp-server import from mcp-server (workspace dep) or duplicate the 30-line `replace()` function?
   - Recommendation: Duplicate the minimal `replace()` into `lsp-server/src/lockfile-writer.ts` (write-only helper). Avoids circular workspace dependency and keeps packages independent.

2. **LSP subprocess resolution from daemon**
   - What we know: `launcher.js` needs to spawn `airtable-user-lsp --tcp`. The daemon process may be running in a context where lsp-server is not in PATH.
   - What's unclear: How does launcher.js find the lsp-server binary at runtime? Options: (A) `require.resolve('airtable-user-lsp/dist/index.mjs')` if installed alongside, (B) `npx airtable-user-lsp --tcp` (implies npm fetch on first run), (C) bundle lsp-server dist into mcp-server dist folder.
   - Recommendation: Option C for VS Code extension context (bundle alongside MCP server). For standalone daemon, fall back to `npx`.

3. **`--lockfile` flag vs env var for port_lsp path**
   - What we know: LSP subprocess needs to know where to write `port_lsp`.
   - What's unclear: Pass lockfile path as `--lockfile <path>` CLI arg, or via env var `AIRTABLE_USER_MCP_HOME` (existing pattern)?
   - Recommendation: Use `AIRTABLE_USER_MCP_HOME` env var (already passed to daemon subprocesses per existing pattern in `spawnDetachedDaemon`). lsp-server reads it to find config dir, derives lockfile path.

---

## Sources

### Primary (HIGH confidence)
- Context7 `/microsoft/vscode-languageserver-node` — `createConnection`, `TextDocuments`, transport setup, capability registration, `StreamMessageReader`/`StreamMessageWriter`
- `github.com/microsoft/vscode-languageserver-node/blob/main/types/src/main.ts` — verified `DiagnosticSeverity` and `CompletionItemKind` numeric values
- `github.com/microsoft/vscode-languageserver-node/blob/main/jsonrpc/src/node/main.ts` — verified `createClientSocketTransport` one-connection behavior
- npm registry — `vscode-languageserver@9.0.1`, `vscode-languageserver-textdocument@1.0.12` confirmed latest

### Secondary (MEDIUM confidence)
- `packages/language-services/src/types.ts` — LsSeverity and LsCompletionItemKind values confirmed from codebase (D-09 annotation: "mirrors vscode.CompletionItemKind exactly")
- `packages/mcp-server/src/daemon/launcher.js` + `lockfile.js` — confirmed `port_lsp` field present in schema, `replace()` function signature, spawn patterns
- `packages/extension/src/language/convert.ts` — confirmed reference implementation shape for lsp-convert.ts

### Tertiary (LOW confidence)
- Lockfile cross-package import strategy — documented as Open Question

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm registry verified, Context7 verified
- Architecture (TCP multi-client): HIGH — source-verified that `createClientSocketTransport` is one-connection-only; `net.createServer` pattern confirmed from Context7
- Enum conversion tables: HIGH — verified from both codebase and official source
- Build bundling (tsup noExternal): MEDIUM — tsup docs not directly checked; pattern is standard
- Daemon spawn integration: MEDIUM — lockfile format verified from codebase; exact spawn call is LOW (open question)

**Research date:** 2026-05-14
**Valid until:** 2026-08-14 (stable; vscode-languageserver releases are infrequent)
