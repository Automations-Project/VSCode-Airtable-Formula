import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripHeader, parseHeader } from '../src/formula-header.js';

describe('stripHeader', () => {
  it('strips leading # AT: lines from formula text', () => {
    const raw = '# AT: appId=appXXX fieldId=fldXXX\nIF({A} = 1, "yes", "no")';
    const { text, offset } = stripHeader(raw, 'formula');
    assert.equal(text, 'IF({A} = 1, "yes", "no")');
    assert.equal(offset, 1);
  });

  it('strips multiple # AT: lines', () => {
    const raw = '# AT: appId=appXXX\n# AT: fieldId=fldXXX\nIF(1,2,3)';
    const { text, offset } = stripHeader(raw, 'formula');
    assert.equal(text, 'IF(1,2,3)');
    assert.equal(offset, 2);
  });

  it('does not strip non-header lines', () => {
    const raw = 'IF({A} = 1, "yes", "no")';
    const { text, offset } = stripHeader(raw, 'formula');
    assert.equal(text, raw);
    assert.equal(offset, 0);
  });

  it('strips // AT: lines for script language', () => {
    const raw = '// AT: appId=appXXX extensionId=extXXX\noutput.text("hi");';
    const { text, offset } = stripHeader(raw, 'script');
    assert.equal(text, 'output.text("hi");');
    assert.equal(offset, 1);
  });

  it('strips inline formula text that was copy-pasted with header', () => {
    const raw = '# AT: appId=appXXX fieldId=fldXXX\nIF({X},1,0)';
    const { text } = stripHeader(raw, 'formula');
    assert.equal(text, 'IF({X},1,0)');
  });

  it('handles empty input', () => {
    const { text, offset } = stripHeader('', 'formula');
    assert.equal(text, '');
    assert.equal(offset, 0);
  });

  it('strips // AT: lines for automation language', () => {
    const raw = '// AT: appId=appXXX automationId=autXXX\nlet x = 1;';
    const { text, offset } = stripHeader(raw, 'automation');
    assert.equal(text, 'let x = 1;');
    assert.equal(offset, 1);
  });
});

describe('parseHeader', () => {
  it('parses simple key=value pairs', () => {
    const raw = '# AT: appId=appXXX tableId=tblXXX fieldId=fldXXX\nIF(1,2,3)';
    const result = parseHeader(raw, 'formula');
    assert.deepEqual(result, { appId: 'appXXX', tableId: 'tblXXX', fieldId: 'fldXXX' });
  });

  it('parses quoted values with spaces', () => {
    const raw = '# AT: appId=appXXX fieldName="My Text Formula"\nIF(1,2,3)';
    const result = parseHeader(raw, 'formula');
    assert.equal(result.fieldName, 'My Text Formula');
  });

  it('returns empty object when no header present', () => {
    const result = parseHeader('IF(1,2,3)', 'formula');
    assert.deepEqual(result, {});
  });

  it('parses // AT: for script language', () => {
    const raw = '// AT: appId=appXXX extensionId=extXXX\noutput.text("hi");';
    const result = parseHeader(raw, 'script');
    assert.deepEqual(result, { appId: 'appXXX', extensionId: 'extXXX' });
  });

  it('parses // AT: for automation language', () => {
    const raw = '// AT: appId=appXXX automationId=autXXX\nlet x = 1;';
    const result = parseHeader(raw, 'automation');
    assert.deepEqual(result, { appId: 'appXXX', automationId: 'autXXX' });
  });
});
