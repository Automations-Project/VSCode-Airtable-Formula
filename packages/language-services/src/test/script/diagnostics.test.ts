import { describe, it, expect } from 'vitest';
import { scriptDiagnostics } from '../../engines/script/index.js';
import { LsSeverity } from '../../index.js';

describe('scriptDiagnostics — SCRIPT-04 missing await', () => {
  it('flags bare selectRecordsAsync() without await (code: missing-await, severity: Warning)', () => {
    const diags = scriptDiagnostics('table.selectRecordsAsync({})');
    const diag = diags.find(d => d.code === 'missing-await');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe(LsSeverity.Warning);
  });

  it('flags bare createRecordAsync() without await', () => {
    const diags = scriptDiagnostics('table.createRecordAsync({Name: "test"})');
    expect(diags.filter(d => d.code === 'missing-await').length).toBeGreaterThan(0);
  });

  it('does NOT flag: await table.selectRecordsAsync({})', () => {
    const diags = scriptDiagnostics('await table.selectRecordsAsync({})');
    expect(diags.filter(d => d.code === 'missing-await')).toHaveLength(0);
  });

  it('does NOT flag: return table.selectRecordsAsync({})', () => {
    const diags = scriptDiagnostics('return table.selectRecordsAsync({})');
    expect(diags.filter(d => d.code === 'missing-await')).toHaveLength(0);
  });

  it('does NOT flag assignment to variable: const p = table.selectRecordsAsync({})', () => {
    const diags = scriptDiagnostics('const p = table.selectRecordsAsync({})');
    expect(diags.filter(d => d.code === 'missing-await')).toHaveLength(0);
  });

  it('does NOT flag .then() chain: table.selectRecordsAsync({}).then(() => {})', () => {
    const diags = scriptDiagnostics('table.selectRecordsAsync({}).then(() => {})');
    expect(diags.filter(d => d.code === 'missing-await')).toHaveLength(0);
  });

  it('does NOT flag chained await: await base.getTable("X").selectRecordsAsync({})', () => {
    const diags = scriptDiagnostics('await base.getTable("X").selectRecordsAsync({})');
    expect(diags.filter(d => d.code === 'missing-await')).toHaveLength(0);
  });

  it('does NOT flag async calls inside Promise.all([])', () => {
    const code = 'const results = await Promise.all([table.selectRecordsAsync({}), base.getTableAsync("x")]);';
    expect(scriptDiagnostics(code).filter(d => d.code === 'missing-await')).toHaveLength(0);
  });
});

describe('scriptDiagnostics — SCRIPT-05 unknown global', () => {
  it('flags unknown global: myLib.doThing() (code: unknown-global)', () => {
    const diags = scriptDiagnostics('myLib.doThing()');
    const diag = diags.find(d => d.code === 'unknown-global');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe(LsSeverity.Warning);
  });

  it('does NOT flag console.log() — JS built-in', () => {
    const diags = scriptDiagnostics('console.log("hello")');
    expect(diags.filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });

  it('does NOT flag Math.floor() — JS built-in', () => {
    const diags = scriptDiagnostics('Math.floor(1.5)');
    expect(diags.filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });

  it('does NOT flag base.getTables() — Airtable global', () => {
    const diags = scriptDiagnostics('base.getTables()');
    expect(diags.filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });

  it('does NOT flag locally-declared variable: const myTable = ...; myTable.selectRecordsAsync({})', () => {
    const code = 'const myTable = base.getTable("X");\nmyTable.selectRecordsAsync({})';
    expect(scriptDiagnostics(code).filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });

  it('does NOT flag function parameter used as identifier', () => {
    const code = 'function process(record) { return record.id; }';
    expect(scriptDiagnostics(code).filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });
});
