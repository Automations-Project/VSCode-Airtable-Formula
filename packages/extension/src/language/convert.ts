import * as vscode from 'vscode';
import type { LsPosition, LsRange, LsDiagnostic, LsHover } from '@airtable-formula/language-services';

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
    return diag;
}

export function toVscodeHover(h: LsHover): vscode.Hover {
    const contents = new vscode.MarkdownString(h.contents.value);
    return new vscode.Hover(contents, h.range ? toVscodeRange(h.range) : undefined);
}
