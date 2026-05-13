import { describe, it, expect } from 'vitest';
import { automationDiagnostics } from '../../engines/automation/index.js';
import { LsSeverity } from '../../index.js';

describe('automationDiagnostics — wrong-context top-level globals', () => {
  it('flags cursor as Warning with code wrong-context', () => {
    const diags = automationDiagnostics('cursor.selectedRecordIds');
    const d = diags.find(d => d.code === 'wrong-context');
    expect(d).toBeDefined();
    expect(d!.severity).toBe(LsSeverity.Warning);
    expect(d!.message).toContain('cursor');
  });

  it('flags session as Warning', () => {
    const diags = automationDiagnostics('session.currentUser');
    const d = diags.find(d => d.code === 'wrong-context');
    expect(d).toBeDefined();
    expect(d!.severity).toBe(LsSeverity.Warning);
    expect(d!.message).toContain('session');
  });

  it('flags remoteFetchAsync as Warning with message referencing fetch()', () => {
    const diags = automationDiagnostics('remoteFetchAsync("https://example.com")');
    const d = diags.find(d => d.code === 'wrong-context');
    expect(d).toBeDefined();
    expect(d!.severity).toBe(LsSeverity.Warning);
    expect(d!.message).toContain('use fetch()');
  });
});

describe('automationDiagnostics — wrong-context method patterns', () => {
  it('flags input.textAsync()', () => {
    const diags = automationDiagnostics('await input.textAsync("prompt")');
    expect(diags.some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('flags input.buttonsAsync()', () => {
    expect(automationDiagnostics('await input.buttonsAsync("pick", [])').some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('flags input.tableAsync()', () => {
    expect(automationDiagnostics('await input.tableAsync("pick table")').some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('flags input.viewAsync()', () => {
    expect(automationDiagnostics('await input.viewAsync("pick view", tbl)').some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('flags input.fieldAsync()', () => {
    expect(automationDiagnostics('await input.fieldAsync("pick field", tbl)').some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('flags input.recordAsync()', () => {
    expect(automationDiagnostics('await input.recordAsync("pick record", tbl)').some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('flags input.fileAsync()', () => {
    expect(automationDiagnostics('await input.fileAsync("upload")').some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('flags output.text()', () => {
    const diags = automationDiagnostics('output.text("hello")');
    const d = diags.find(d => d.code === 'wrong-context');
    expect(d).toBeDefined();
    expect(d!.message).toContain('output.set()');
  });

  it('flags output.markdown()', () => {
    expect(automationDiagnostics('output.markdown("## hi")').some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('flags output.table()', () => {
    expect(automationDiagnostics('output.table(records)').some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('flags output.clear()', () => {
    expect(automationDiagnostics('output.clear()').some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('flags output.inspect()', () => {
    expect(automationDiagnostics('output.inspect(thing)').some(d => d.code === 'wrong-context')).toBe(true);
  });

  it('does NOT false-positive on output.tableData property access (no open paren)', () => {
    // output.tableData is not a call — no wrong-context diagnostic expected
    // (method patterns require \s*\( at end to confirm call expression)
    const diags = automationDiagnostics('const x = output.tableData;');
    expect(diags.filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });
});

describe('automationDiagnostics — allowed automation APIs', () => {
  it('does NOT flag input.config()', () => {
    expect(automationDiagnostics('const cfg = input.config()').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });

  it('does NOT flag output.set()', () => {
    expect(automationDiagnostics('output.set("key", "value")').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });

  it('does NOT flag fetch()', () => {
    expect(automationDiagnostics('const r = await fetch("https://api.example.com")').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });

  it('does NOT flag base.getTable()', () => {
    expect(automationDiagnostics('const t = base.getTable("name")').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });

  it('does NOT flag table.selectRecordsAsync()', () => {
    expect(automationDiagnostics('const recs = await table.selectRecordsAsync()').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });
});

describe('automationDiagnostics — exclusion ranges', () => {
  it('does NOT flag forbidden identifiers inside double-quoted string literals', () => {
    expect(automationDiagnostics('"cursor is not available"').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });

  it('does NOT flag forbidden identifiers inside single-quoted string literals', () => {
    expect(automationDiagnostics("'session is scripting only'").filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });

  it('does NOT flag forbidden identifiers inside line comments', () => {
    expect(automationDiagnostics('// cursor is scripting only').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });

  it('does NOT flag forbidden identifiers inside block comments', () => {
    expect(automationDiagnostics('/* remoteFetchAsync example */').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });

  it('does NOT flag forbidden identifiers inside template literals', () => {
    expect(automationDiagnostics('const msg = `cursor: ${x}`').filter(d => d.code === 'wrong-context')).toHaveLength(0);
  });

  it('sequential calls produce correct results (lastIndex reset check)', () => {
    // Call twice on different inputs — stale lastIndex would cause second call to miss matches
    const first = automationDiagnostics('cursor.selectedRecordIds');
    const second = automationDiagnostics('cursor.selectedRecordIds');
    expect(first.filter(d => d.code === 'wrong-context')).toHaveLength(1);
    expect(second.filter(d => d.code === 'wrong-context')).toHaveLength(1);
  });
});
