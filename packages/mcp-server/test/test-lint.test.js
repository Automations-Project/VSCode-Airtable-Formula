// node --test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintAirtableCode, MAX_TEXT_LENGTH, MAX_DIAGNOSTICS } from '../src/lint.js';

describe('lintAirtableCode', () => {
  it('a valid formula is clean', () => {
    const r = lintAirtableCode({ language: 'formula', text: 'IF({Qty}=0, BLANK(), {Total}/{Qty})' });
    assert.equal(r.clean, true);
    assert.equal(r.errorCount, 0);
    assert.deepEqual(r.diagnostics, []);
    assert.equal('truncated' in r, false);
  });

  it('an unknown formula function is an error at a 1-based position', () => {
    const r = lintAirtableCode({ language: 'formula', text: 'NOPE(1)' });
    assert.equal(r.clean, false);
    assert.ok(r.errorCount >= 1);
    const d = r.diagnostics[0];
    assert.equal(d.severity, 'error');
    assert.equal(d.line, 1);
    assert.equal(d.column, 1);
    assert.ok(d.endColumn > d.column);
    assert.match(d.message, /NOPE/);
  });

  it('a # AT: header is skipped and lines point at the original text', () => {
    const r = lintAirtableCode({ language: 'formula', text: '# AT: appId=app1 fieldName="X"\nNOPE(1)' });
    assert.equal(r.diagnostics[0].line, 2);
  });

  it('CRLF text reports the same lines as LF text', () => {
    const lf = lintAirtableCode({ language: 'formula', text: '1\n+\nNOPE(1)' });
    const crlf = lintAirtableCode({ language: 'formula', text: '1\r\n+\r\nNOPE(1)' });
    assert.equal(crlf.diagnostics[0].line, lf.diagnostics[0].line);
    assert.equal(lf.diagnostics[0].line, 3);
  });

  it('script: a bare selectRecordsAsync without await is a warning', () => {
    const r = lintAirtableCode({ language: 'script', text: 'table.selectRecordsAsync({})' });
    assert.ok(r.warningCount >= 1);
    assert.ok(r.diagnostics.some(d => d.severity === 'warning' && d.code === 'missing-await'));
  });

  it('automation: cursor is flagged as wrong-context', () => {
    const r = lintAirtableCode({ language: 'automation', text: 'cursor.selectedRecordIds' });
    assert.ok(r.diagnostics.some(d => d.code === 'wrong-context' && /cursor/.test(d.message)));
  });

  it('diagnostics are sorted by position and capped', () => {
    const text = Array.from({ length: MAX_DIAGNOSTICS + 5 }, () => 'NOPE(1)').join('\n');
    const r = lintAirtableCode({ language: 'formula', text });
    assert.equal(r.diagnostics.length, MAX_DIAGNOSTICS);
    assert.equal(r.truncated, MAX_DIAGNOSTICS + 5, 'truncated is the total found');
    assert.equal(r.errorCount, MAX_DIAGNOSTICS + 5, 'counts cover every diagnostic, not only the returned slice');
    for (let i = 1; i < r.diagnostics.length; i++) {
      const a = r.diagnostics[i - 1], b = r.diagnostics[i];
      assert.ok(a.line < b.line || (a.line === b.line && a.column <= b.column));
    }
  });

  it('rejects an unknown language', () => {
    assert.throws(() => lintAirtableCode({ language: 'sql', text: 'x' }), /language must be one of formula, script, automation/);
  });

  it('rejects non-string text', () => {
    assert.throws(() => lintAirtableCode({ language: 'formula', text: 42 }), /text must be a string/);
  });

  it('rejects text over the limit', () => {
    const text = 'a'.repeat(MAX_TEXT_LENGTH + 1);
    assert.throws(() => lintAirtableCode({ language: 'formula', text }), /too long/);
  });

  it('a run of unmatched parens near the limit lints fast (it used to pin the thread for ~25 s)', () => {
    const start = performance.now();
    const r = lintAirtableCode({ language: 'script', text: '('.repeat(199_000) });
    const elapsed = performance.now() - start;
    assert.equal(r.language, 'script');
    assert.ok(elapsed < 3_000, `took ${elapsed.toFixed(0)} ms`);
  });

  it('150k unbalanced parens lint fast and are truncated, not an error, and the next call still works', () => {
    // This used to throw RangeError: its 150k diagnostics overflowed a push(...spread).
    const start = performance.now();
    const r = lintAirtableCode({ language: 'formula', text: '('.repeat(150_000) });
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 3_000, `took ${elapsed.toFixed(0)} ms`);
    assert.equal(r.clean, false);
    assert.equal(typeof r.truncated, 'number');
    assert.equal(lintAirtableCode({ language: 'formula', text: 'IF(1,2,3)' }).clean, true);
  });
});

describe('lint_airtable_code wiring', () => {
  it('is defined, handled and categorised as read, and the handler never touches auth or client', () => {
    const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
    assert.ok(src.includes("name: 'lint_airtable_code'"));
    const handlerStart = src.indexOf('async lint_airtable_code(');
    assert.ok(handlerStart > 0, 'handler present');
    const handlerBody = src.slice(handlerStart, src.indexOf('\n  },', handlerStart));
    assert.equal(/\b(auth|client)\./.test(handlerBody), false, 'handler must not touch auth or client');
    const defStart = src.indexOf("name: 'lint_airtable_code'");
    const definition = src.slice(defStart, src.indexOf('\n  },', defStart));
    assert.match(definition, /text: \{ type: 'string', maxLength: LINT_MAX_TEXT_LENGTH,/, 'the text cap is in the schema');
    assert.equal(MAX_TEXT_LENGTH, 200_000, 'the description promises 200000');
    const cfg = readFileSync(new URL('../src/tool-config.js', import.meta.url), 'utf8');
    assert.match(cfg, /lint_airtable_code:\s*'read'/);
  });
});
