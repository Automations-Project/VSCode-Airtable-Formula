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

// Before the arrow-param and missing-await scans were bounded, each of these
// took 20-40 s on one thread (a lint call could pin the shared MCP daemon).
describe('scriptDiagnostics — adversarial input stays fast', () => {
  function timed(text: string) {
    const start = performance.now();
    const diags = scriptDiagnostics(text);
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

  it('a paren-arrow default value does not hide the earlier parameters', () => {
    const code = 'const process = (records, log = (m) => console.log(m)) => records.map(r => log(r.id));';
    expect(scriptDiagnostics(code).filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });

  it('every parameter of functions sharing one closing paren is still declared', () => {
    const code = 'function f(a, function g(b, c) { return a.x + b.y + c.z }';
    expect(scriptDiagnostics(code).filter(d => d.code === 'unknown-global')).toHaveLength(0);
  });

  // \s*[=:].*$ in extractBindings retried \s* from every position of a whitespace run.
  it('finishes a 200k-character whitespace run inside arrow params in under 2 s', () => {
    const { diags, elapsed } = timed('(a' + ' '.repeat(199_990) + 'b) =>');
    expect(Array.isArray(diags)).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });
});
