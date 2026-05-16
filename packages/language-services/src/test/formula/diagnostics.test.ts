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

describe('formulaDiagnostics — nested-if', () => {
  // Build a dispatch-table chain: IF({Game}='A', v, IF({Game}='B', v, ...))
  function makeDispatchChain(n: number): string {
    const games = Array.from({ length: n }, (_, i) => `'G${i}'`);
    let formula = "''";
    for (let i = n - 1; i >= 0; i--) {
      formula = `IF({Game}=${games[i]}, 'result${i}', ${formula})`;
    }
    return formula;
  }

  // Build a logic-nesting chain: IF(condA, IF(condB, IF(condC, ...)))
  function makeLogicChain(n: number): string {
    let formula = "''";
    for (let i = n - 1; i >= 0; i--) {
      formula = `IF({Field${i}}='val', 'ok', ${formula})`;
    }
    return formula;
  }

  it('does NOT fire nested-if for a dispatch table with 8 cases', () => {
    const diags = formulaDiagnostics(makeDispatchChain(8));
    expect(diags.filter(d => d.code === 'nested-if')).toHaveLength(0);
  });

  it('does NOT fire nested-if for a dispatch table with 40 cases', () => {
    const diags = formulaDiagnostics(makeDispatchChain(40));
    expect(diags.filter(d => d.code === 'nested-if')).toHaveLength(0);
  });

  it('fires nested-if for logic nesting with 5 different conditions', () => {
    const diags = formulaDiagnostics(makeLogicChain(5));
    expect(diags.filter(d => d.code === 'nested-if')).toHaveLength(1);
  });

  it('does not fire nested-if when depth is below threshold (3 levels)', () => {
    const diags = formulaDiagnostics(makeDispatchChain(3));
    expect(diags.filter(d => d.code === 'nested-if')).toHaveLength(0);
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
