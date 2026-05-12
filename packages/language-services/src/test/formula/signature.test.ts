import { describe, it, expect } from 'vitest';
import { formulaSignatureHelp } from '../../engines/formula/index.js';

describe('formulaSignatureHelp — basic behavior', () => {
  it('returns non-null for cursor inside IF( call', () => {
    const help = formulaSignatureHelp('IF(', { line: 0, character: 3 });
    expect(help).not.toBeNull();
    expect(help?.signatures).toHaveLength(1);
    expect(help?.signatures[0].label).toContain('IF(');
  });

  it('activeParameter is 0 when cursor is at first argument position', () => {
    const help = formulaSignatureHelp('IF(', { line: 0, character: 3 });
    expect(help?.activeParameter).toBe(0);
  });

  it('activeParameter is 1 after first comma', () => {
    const help = formulaSignatureHelp('IF(1, ', { line: 0, character: 6 });
    expect(help?.activeParameter).toBe(1);
  });

  it('activeParameter is 2 after second comma', () => {
    const help = formulaSignatureHelp('IF(1, 2, ', { line: 0, character: 9 });
    expect(help?.activeParameter).toBe(2);
  });

  it('returns null when cursor is outside any function call', () => {
    const help = formulaSignatureHelp('IF(1, 2, 3)', { line: 0, character: 11 });
    expect(help).toBeNull();
  });
});

describe('formulaSignatureHelp — parameters shape', () => {
  it('signatures[0].parameters is populated for multi-param function', () => {
    const help = formulaSignatureHelp('IF(', { line: 0, character: 3 });
    expect(help?.signatures[0].parameters.length).toBeGreaterThan(0);
  });

  it('activeSignature is always 0 (Airtable functions have one signature)', () => {
    const help = formulaSignatureHelp('IF(1, ', { line: 0, character: 6 });
    expect(help?.activeSignature).toBe(0);
  });
});

describe('formulaSignatureHelp — unknown function', () => {
  it('returns null for an unrecognized function call', () => {
    const help = formulaSignatureHelp('NOTAFUNC(', { line: 0, character: 9 });
    expect(help).toBeNull();
  });
});
