import { describe, it, expect } from 'vitest';
import type {
  LsMarkdownString,
  LsPosition,
  LsRange,
  LsDiagnostic,
  LsCompletionItem,
  LsHover,
} from '../index.js';
// Note: const enum values are inlined at compile time — import the compiled values via a value import
// Use LsSeverity and LsCompletionItemKind from the compiled output
import { LsSeverity, LsCompletionItemKind } from '../index.js';

describe('language-services types', () => {
  it('LsPosition shape is correct', () => {
    const pos: LsPosition = { line: 0, character: 5 };
    expect(pos.line).toBe(0);
    expect(pos.character).toBe(5);
  });

  it('LsRange shape is correct', () => {
    const range: LsRange = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 10 },
    };
    expect(range.start.line).toBe(0);
    expect(range.end.character).toBe(10);
  });

  it('LsDiagnostic shape is correct', () => {
    const diag: LsDiagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      message: 'Unknown function',
      severity: LsSeverity.Error,
    };
    expect(diag.message).toBe('Unknown function');
    expect(diag.severity).toBe(0); // Error = 0 (D-09)
  });

  it('LsCompletionItem shape is correct', () => {
    const item: LsCompletionItem = {
      label: 'IF',
      kind: LsCompletionItemKind.Function,
      detail: '(logical, value1, value2)',
    };
    expect(item.label).toBe('IF');
    expect(item.kind).toBe(2); // Function = 2 (D-09)
  });

  it('LsHover shape is correct', () => {
    const hover: LsHover = {
      contents: { kind: 'markdown', value: '**IF** function' },
    };
    expect(hover.contents.kind).toBe('markdown');
    expect(hover.contents.value).toBe('**IF** function');
  });

  it('LsMarkdownString supports both kinds', () => {
    const md: LsMarkdownString = { kind: 'markdown', value: '# Header' };
    const plain: LsMarkdownString = { kind: 'plaintext', value: 'plain text' };
    expect(md.kind).toBe('markdown');
    expect(plain.kind).toBe('plaintext');
  });

  it('LsSeverity values mirror vscode.DiagnosticSeverity (D-09)', () => {
    expect(LsSeverity.Error).toBe(0);
    expect(LsSeverity.Warning).toBe(1);
    expect(LsSeverity.Information).toBe(2);
    expect(LsSeverity.Hint).toBe(3);
  });

  it('LsCompletionItemKind values mirror vscode.CompletionItemKind (D-09)', () => {
    expect(LsCompletionItemKind.Text).toBe(0);
    expect(LsCompletionItemKind.Method).toBe(1);
    expect(LsCompletionItemKind.Function).toBe(2);
    expect(LsCompletionItemKind.Keyword).toBe(13);
    expect(LsCompletionItemKind.TypeParameter).toBe(24);
  });
});
