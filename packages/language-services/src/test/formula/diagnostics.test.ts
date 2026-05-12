import { describe, it, expect } from 'vitest';
import { formulaDiagnostics } from '../../engines/formula/index.js';
import { LsSeverity } from '../../index.js';

describe('formulaDiagnostics — unknown function', () => {
  it('flags an unknown function call with code "unknown-function"', () => {
    const diags = formulaDiagnostics('NOTAFUNC(1, 2)');
    const diag = diags.find(d => d.code === 'unknown-function');
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe(LsSeverity.Error);
  });

  it('does not flag a known function IF', () => {
    const diags = formulaDiagnostics('IF(1, 2, 3)');
    expect(diags.filter(d => d.code === 'unknown-function')).toHaveLength(0);
  });
});

describe('formulaDiagnostics — TRUE/FALSE pitfall (Pitfall 3)', () => {
  it('does NOT flag missing parenthesis for TRUE or FALSE used as bare literals', () => {
    const diags = formulaDiagnostics('IF({Field}, TRUE, FALSE)');
    expect(diags.filter(d => d.code === 'missing-function-parenthesis')).toHaveLength(0);
  });
});

describe('formulaDiagnostics — common typos', () => {
  it('flags VLOOKUP with code "common-typo"', () => {
    const diags = formulaDiagnostics('VLOOKUP(x)');
    const diag = diags.find(d => d.code === 'common-typo');
    expect(diag).toBeDefined();
  });
});

describe('formulaDiagnostics — comments', () => {
  it('flags single-line comment // with code "no-comments"', () => {
    const diags = formulaDiagnostics('IF(1, 2, 3) // comment');
    const diag = diags.find(d => d.code === 'no-comments');
    expect(diag).toBeDefined();
  });
});

describe('formulaDiagnostics — result shape', () => {
  it('diagnostic range has line and character fields', () => {
    const diags = formulaDiagnostics('NOTAFUNC(1)');
    expect(diags.length).toBeGreaterThan(0);
    expect(typeof diags[0].range.start.line).toBe('number');
    expect(typeof diags[0].range.start.character).toBe('number');
  });

  it('clean formula produces zero diagnostics', () => {
    const diags = formulaDiagnostics('IF(AND(1, 2), CONCATENATE("a", "b"), "")');
    expect(diags).toHaveLength(0);
  });
});
