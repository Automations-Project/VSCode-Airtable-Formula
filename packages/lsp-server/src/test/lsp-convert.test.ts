import { describe, it, expect } from 'vitest';
import { toLspSeverity, toLspCompletionKind } from '../lsp-convert.js';
import { LsSeverity, LsCompletionItemKind } from '@airtable-formula/language-services';

describe('lsp-convert: toLspSeverity', () => {
  it('applies +1 offset: Error(0) → DiagnosticSeverity.Error(1)', () => {
    expect(toLspSeverity(LsSeverity.Error)).toBe(1);
  });
  it('applies +1 offset: Warning(1) → DiagnosticSeverity.Warning(2)', () => {
    expect(toLspSeverity(LsSeverity.Warning)).toBe(2);
  });
  it('applies +1 offset: Information(2) → DiagnosticSeverity.Information(3)', () => {
    expect(toLspSeverity(LsSeverity.Information)).toBe(3);
  });
  it('applies +1 offset: Hint(3) → DiagnosticSeverity.Hint(4)', () => {
    expect(toLspSeverity(LsSeverity.Hint)).toBe(4);
  });
});

describe('lsp-convert: toLspCompletionKind', () => {
  it('applies +1 offset: Text(0) → CompletionItemKind.Text(1)', () => {
    expect(toLspCompletionKind(LsCompletionItemKind.Text)).toBe(1);
  });
  it('applies +1 offset: Function(2) → CompletionItemKind.Function(3)', () => {
    expect(toLspCompletionKind(LsCompletionItemKind.Function)).toBe(3);
  });
  it('applies +1 offset: TypeParameter(24) → CompletionItemKind.TypeParameter(25)', () => {
    expect(toLspCompletionKind(LsCompletionItemKind.TypeParameter)).toBe(25);
  });
});
