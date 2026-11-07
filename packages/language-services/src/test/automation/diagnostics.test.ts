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

// Before the arrow-param and missing-await scans were bounded, each of these
// took 20-40 s on one thread (a lint call could pin the shared MCP daemon).
describe('automationDiagnostics — adversarial input stays fast', () => {
  function timed(text: string) {
    const start = performance.now();
    const diags = automationDiagnostics(text);
    return { diags, elapsed: performance.now() - start };
  }

  it("finishes '('.repeat(200_000) in under 2 s", () => {
    const { diags, elapsed } = timed('('.repeat(200_000));
    expect(Array.isArray(diags)).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("finishes 'xAsync('.repeat(28_000) in under 2 s, still flagging every call", () => {
    const { diags, elapsed } = timed('xAsync('.repeat(28_000));
    expect(Array.isArray(diags)).toBe(true);
    expect(diags.filter(d => d.code === 'missing-await')).toHaveLength(28_000);
    expect(elapsed).toBeLessThan(2_000);
  });

  // Identifier regexes: `$` is an identifier char but not a \w one, so \b held at
  // every a/$ transition and each attempt scanned the rest of the run (~90 s at the cap).
  it("finishes 'a$'.repeat(100_000) in under 2 s", () => {
    const { diags, elapsed } = timed('a$'.repeat(100_000));
    expect(Array.isArray(diags)).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });

  // [^\]};]* in the const/let/var destructuring pattern rescanned to the same stop.
  it("finishes 'const ['.repeat(28_000) in under 2 s", () => {
    const { diags, elapsed } = timed('const ['.repeat(28_000));
    expect(Array.isArray(diags)).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });

  // Many for-heads whose destructuring patterns share one `]`, then a long whitespace
  // run the of|in tail scans and fails on. The tail used to be retried per head;
  // at this size that cost about 1.1-1.6 s, so the bound is tighter than 2 s to catch it.
  it('tries the for-of tail once per binding end, not once per head', () => {
    const { diags, elapsed } = timed('for(let ['.repeat(11_000) + ']' + ' '.repeat(100_000) + 'x');
    expect(Array.isArray(diags)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  // function NAME( heads reaching the same ')' each re-split their whole parameter
  // slice on ',': O(heads x commas), 17 s to over 60 s at the cap.
  it.each([
    ["'function f(a,'.repeat(15_384) + ')'", () => 'function f(a,'.repeat(15_384) + ')'],
    ["'function f('.repeat(9_090) + ','.repeat(100_000) + ')'", () => 'function f('.repeat(9_090) + ','.repeat(100_000) + ')'],
    ["'function f('.repeat(9_090) + 'a=1,'.repeat(25_000) + ')'", () => 'function f('.repeat(9_090) + 'a=1,'.repeat(25_000) + ')'],
  ])('finishes %s in under 2 s', (_label, make) => {
    const { diags, elapsed } = timed(make());
    expect(Array.isArray(diags)).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });

  // Comma-free heads reaching one ')' re-processed overlapping first pieces, and
  // stripDefaultOrType walked back over the whitespace before '=' with a regex
  // test per character: ~18-20 s at the cap.
  it.each([
    ["'function f('.repeat(9_090) + ' '.repeat(100_000) + '=1)'", () => 'function f('.repeat(9_090) + ' '.repeat(100_000) + '=1)'],
    ["'function f('.repeat(9_090) + '\\n'.repeat(100_000) + '=1)'", () => 'function f('.repeat(9_090) + '\n'.repeat(100_000) + '=1)'],
    ["'function f('.repeat(9_090) + '\\t'.repeat(100_000) + '=1)'", () => 'function f('.repeat(9_090) + '\t'.repeat(100_000) + '=1)'],
    ["'function f('.repeat(18_181) + '=1)'", () => 'function f('.repeat(18_181) + '=1)'],
  ])('finishes %s in under 2 s', (_label, make) => {
    const { diags, elapsed } = timed(make());
    expect(Array.isArray(diags)).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('a paren-arrow default value does not hide the earlier parameters', () => {
    const code = 'const process = (records, log = (m) => console.log(m)) => records.map(r => log(r.id));';
    expect(automationDiagnostics(code).filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });

  it('every parameter of functions sharing one closing paren is still declared', () => {
    const code = 'function f(a, function g(b, c) { return a.x + b.y + c.z }';
    expect(automationDiagnostics(code).filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });

  // \s*[=:].*$ in extractBindings retried \s* from every position of a whitespace run.
  it('finishes a 200k-character whitespace run inside arrow params in under 2 s', () => {
    const { diags, elapsed } = timed('(a' + ' '.repeat(199_990) + 'b) =>');
    expect(Array.isArray(diags)).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });
});
