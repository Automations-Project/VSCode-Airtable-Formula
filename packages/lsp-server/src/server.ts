import {
  TextDocuments, TextDocumentSyncKind,
  type Connection, type InitializeResult,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { LsPosition } from '@airtable-formula/language-services';
import {
  formulaDiagnostics, formulaCompletions, formulaHover, formulaSignatureHelp,
  scriptDiagnostics, scriptCompletions, scriptHover,
  automationDiagnostics, automationCompletions, automationHover,
} from '@airtable-formula/language-services';
import { routeDocument } from './router.js';
import {
  toLspDiagnostic, toLspCompletionItem, toLspHover, toLspSignatureHelp,
} from './lsp-convert.js';

function toLsPosition(pos: { line: number; character: number }): LsPosition {
  return { line: pos.line, character: pos.character };
}

/**
 * Register all LSP handlers on a connection.
 * Creates a new TextDocuments instance per call — each connection has independent document state.
 * Call connection.listen() after this function.
 *
 * Implements D-07 (routing), D-08 (signatureHelp formula-only), LSP-02.
 */
export function registerHandlers(connection: Connection): void {
  // NEW TextDocuments per connection — do NOT share across connections (RESEARCH.md Pitfall 5)
  const documents = new TextDocuments(TextDocument);

  // Push-based diagnostics on content change (not pull-based diagnosticProvider capability)
  documents.onDidChangeContent((change) => {
    const doc = change.document;
    const engine = routeDocument(doc.uri, doc.languageId);
    if (!engine) {
      connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
      return;
    }
    const text = doc.getText();
    let lsDiags;
    if (engine === 'formula') {
      lsDiags = formulaDiagnostics(text, doc.uri);
    } else if (engine === 'script') {
      lsDiags = scriptDiagnostics(text, doc.uri);
    } else {
      lsDiags = automationDiagnostics(text, doc.uri);
    }
    connection.sendDiagnostics({
      uri: doc.uri,
      diagnostics: lsDiags.map(toLspDiagnostic),
    });
  });

  // Clear diagnostics on file close (RESEARCH.md Pitfall 4)
  documents.onDidClose((e) => {
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  connection.onInitialize((): InitializeResult => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['(', '{', "'", '"', '.'],
      },
      hoverProvider: true,
      // D-08: signatureHelp is advertised for all language IDs but is formula-engine only.
      // Script and automation documents always return null — this is intentional per the LSP
      // spec (null is a valid response) and avoids dynamic capability registration complexity.
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
      },
    },
  }));

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const engine = routeDocument(doc.uri, doc.languageId);
    if (!engine) return [];
    const pos = toLsPosition(params.position);
    const text = doc.getText();
    let items;
    if (engine === 'formula') {
      items = formulaCompletions(text, pos);
    } else if (engine === 'script') {
      items = scriptCompletions(text, pos);
    } else {
      items = automationCompletions(text, pos);
    }
    return items.map(toLspCompletionItem);
  });

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const engine = routeDocument(doc.uri, doc.languageId);
    if (!engine) return null;
    const pos = toLsPosition(params.position);
    const text = doc.getText();
    let hover;
    if (engine === 'formula') {
      hover = formulaHover(text, pos);
    } else if (engine === 'script') {
      hover = scriptHover(text, pos);
    } else {
      hover = automationHover(text, pos);
    }
    return hover ? toLspHover(hover) : null;
  });

  // D-08: signatureHelp is formula engine only
  // Script and automation engines do not implement signature help
  connection.onSignatureHelp((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const engine = routeDocument(doc.uri, doc.languageId);
    if (engine !== 'formula') return null;
    const pos = toLsPosition(params.position);
    const sh = formulaSignatureHelp(doc.getText(), pos);
    return sh ? toLspSignatureHelp(sh) : null;
  });

  documents.listen(connection);
  // Caller is responsible for calling connection.listen()
}
