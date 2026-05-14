import type {
  LsPosition, LsRange, LsDiagnostic, LsHover,
  LsCompletionItem, LsSignatureHelp,
} from '@airtable-formula/language-services';
import { LsSeverity, LsCompletionItemKind } from '@airtable-formula/language-services';
import {
  DiagnosticSeverity, CompletionItemKind,
  type Diagnostic, type CompletionItem,
  type Hover, type SignatureHelp, type SignatureInformation,
  Range, Position,
} from 'vscode-languageserver-types';

function toLspPosition(p: LsPosition) {
  return Position.create(p.line, p.character);
}

function toLspRange(r: LsRange) {
  return Range.create(r.start.line, r.start.character, r.end.line, r.end.character);
}

// LsSeverity (0-based, mirrors vscode) → LSP DiagnosticSeverity (1-based)
// +1 offset verified: LsSeverity.Error=0 → DiagnosticSeverity.Error=1
export function toLspSeverity(s: LsSeverity): DiagnosticSeverity {
  return (s + 1) as DiagnosticSeverity;
}

// LsCompletionItemKind (0-based, mirrors vscode) → LSP CompletionItemKind (1-based)
// +1 offset verified for all 25 members
export function toLspCompletionKind(k: LsCompletionItemKind): CompletionItemKind {
  return (k + 1) as CompletionItemKind;
}

export function toLspDiagnostic(d: LsDiagnostic): Diagnostic {
  const diag: Diagnostic = {
    range: toLspRange(d.range),
    message: d.message,
    severity: toLspSeverity(d.severity),
  };
  if (d.code !== undefined) diag.code = d.code;
  if (d.source !== undefined) diag.source = d.source;
  if (d.relatedInformation) {
    diag.relatedInformation = d.relatedInformation.map((ri) => ({
      location: { uri: ri.location.uri, range: toLspRange(ri.location.range) },
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
      : { kind: item.documentation.kind === 'markdown' ? 'markdown' : 'plaintext', value: item.documentation.value };
  }
  if (item.insertText !== undefined) ci.insertText = item.insertText;
  if (item.filterText !== undefined) ci.filterText = item.filterText;
  if (item.sortText !== undefined) ci.sortText = item.sortText;
  return ci;
}

export function toLspHover(h: LsHover): Hover {
  return {
    contents: {
      kind: h.contents.kind === 'markdown' ? 'markdown' : 'plaintext',
      value: h.contents.value,
    },
    range: h.range ? toLspRange(h.range) : undefined,
  };
}

export function toLspSignatureHelp(sh: LsSignatureHelp): SignatureHelp {
  return {
    signatures: sh.signatures.map((sig) => ({
      label: sig.label,
      documentation: sig.documentation
        ? { kind: 'markdown' as const, value: sig.documentation }
        : undefined,
      parameters: sig.parameters.map((p) => ({
        label: p.label,
        documentation: p.documentation,
      })),
    } as SignatureInformation)),
    activeSignature: sh.activeSignature,
    activeParameter: sh.activeParameter,
  };
}
