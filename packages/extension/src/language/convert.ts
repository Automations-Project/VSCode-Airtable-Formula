import * as vscode from 'vscode';
import type { LsPosition, LsRange, LsDiagnostic, LsHover, LsCompletionItem, LsSignatureHelp } from '@airtable-formula/language-services';

export function toLsPosition(pos: vscode.Position): LsPosition {
    return { line: pos.line, character: pos.character };
}

export function toVscodePosition(pos: LsPosition): vscode.Position {
    return new vscode.Position(pos.line, pos.character);
}

export function toLsRange(range: vscode.Range): LsRange {
    return { start: toLsPosition(range.start), end: toLsPosition(range.end) };
}

export function toVscodeRange(range: LsRange): vscode.Range {
    return new vscode.Range(toVscodePosition(range.start), toVscodePosition(range.end));
}

export function toVscodeDiagnostic(d: LsDiagnostic): vscode.Diagnostic {
    // D-09: LsSeverity values mirror vscode.DiagnosticSeverity numerics — direct cast
    const diag = new vscode.Diagnostic(
        toVscodeRange(d.range),
        d.message,
        d.severity as unknown as vscode.DiagnosticSeverity
    );
    if (d.code !== undefined) { diag.code = d.code; }
    if (d.source !== undefined) { diag.source = d.source; }
    if (d.relatedInformation) {
        diag.relatedInformation = d.relatedInformation.map(ri =>
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(
                    vscode.Uri.parse(ri.location.uri),
                    toVscodeRange(ri.location.range)
                ),
                ri.message
            )
        );
    }
    return diag;
}

export function toVscodeHover(h: LsHover): vscode.Hover {
    const content = h.contents.kind === 'plaintext'
        ? h.contents.value
        : new vscode.MarkdownString(h.contents.value);
    return new vscode.Hover(content, h.range ? toVscodeRange(h.range) : undefined);
}

export function toVscodeCompletionItem(item: LsCompletionItem): vscode.CompletionItem {
    const vsItem = new vscode.CompletionItem(
        item.label,
        item.kind as unknown as vscode.CompletionItemKind  // D-09: direct cast, numeric parity
    );
    if (item.insertText !== undefined) {
        vsItem.insertText = new vscode.SnippetString(item.insertText);
    }
    if (item.detail !== undefined) { vsItem.detail = item.detail; }
    if (item.documentation !== undefined) {
        vsItem.documentation = typeof item.documentation === 'string'
            ? item.documentation
            : new vscode.MarkdownString(item.documentation.value);
    }
    if (item.filterText !== undefined) { vsItem.filterText = item.filterText; }
    if (item.sortText !== undefined) { vsItem.sortText = item.sortText; }
    return vsItem;
}

export function toVscodeSignatureHelp(sh: LsSignatureHelp): vscode.SignatureHelp {
    const help = new vscode.SignatureHelp();
    help.signatures = sh.signatures.map(sig => {
        const vsSig = new vscode.SignatureInformation(
            sig.label,
            sig.documentation ? new vscode.MarkdownString(sig.documentation) : undefined
        );
        vsSig.parameters = sig.parameters.map(p =>
            new vscode.ParameterInformation(p.label, p.documentation)
        );
        return vsSig;
    });
    help.activeSignature = sh.activeSignature;
    help.activeParameter = sh.activeParameter;
    return help;
}
