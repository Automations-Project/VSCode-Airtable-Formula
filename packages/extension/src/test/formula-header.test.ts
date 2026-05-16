import { describe, it, expect } from 'vitest';
import { stripFormulaHeader, parseFormulaHeader } from '../language/formula/formula-header.js';

describe('stripFormulaHeader', () => {
  it('strips # AT: line and returns offset 1', () => {
    const { formula, offset } = stripFormulaHeader('# AT: appId=appXXX fieldId=fldXXX\nIF({A},1,0)');
    expect(formula).toBe('IF({A},1,0)');
    expect(offset).toBe(1);
  });

  it('strips multiple # AT: lines', () => {
    const { formula, offset } = stripFormulaHeader('# AT: appId=appXXX\n# AT: fieldId=fldXXX\nIF(1,2,3)');
    expect(formula).toBe('IF(1,2,3)');
    expect(offset).toBe(2);
  });

  it('returns offset 0 when no header', () => {
    const { formula, offset } = stripFormulaHeader('IF({A},1,0)');
    expect(formula).toBe('IF({A},1,0)');
    expect(offset).toBe(0);
  });

  it('strips // AT: for script language', () => {
    const { formula, offset } = stripFormulaHeader('// AT: appId=appXXX\noutput.text("hi");', 'script');
    expect(formula).toBe('output.text("hi");');
    expect(offset).toBe(1);
  });

  it('strips // AT: for automation language', () => {
    const { formula, offset } = stripFormulaHeader('// AT: appId=appXXX automationId=autXXX\nlet x = 1;', 'automation');
    expect(formula).toBe('let x = 1;');
    expect(offset).toBe(1);
  });

  it('handles empty string', () => {
    const { formula, offset } = stripFormulaHeader('');
    expect(formula).toBe('');
    expect(offset).toBe(0);
  });

  it('normalizes CRLF before splitting', () => {
    const { formula, offset } = stripFormulaHeader('# AT: appId=appXXX\r\nIF(1,2,3)');
    expect(formula).toBe('IF(1,2,3)');
    expect(offset).toBe(1);
  });
});

describe('parseFormulaHeader', () => {
  it('parses key=value pairs', () => {
    const result = parseFormulaHeader('# AT: appId=appXXX tableId=tblXXX fieldId=fldXXX\nIF(1,2,3)');
    expect(result).toEqual({ appId: 'appXXX', tableId: 'tblXXX', fieldId: 'fldXXX' });
  });

  it('parses quoted fieldName with spaces', () => {
    const result = parseFormulaHeader('# AT: appId=appXXX fieldName="Text Formula"\nIF(1,2,3)');
    expect(result.fieldName).toBe('Text Formula');
  });

  it('returns empty object when no header', () => {
    expect(parseFormulaHeader('IF(1,2,3)')).toEqual({});
  });

  it('parses // AT: for script language', () => {
    const result = parseFormulaHeader('// AT: appId=appXXX extensionId=extXXX\noutput.text("hi");', 'script');
    expect(result).toEqual({ appId: 'appXXX', extensionId: 'extXXX' });
  });

  it('parses // AT: for automation language', () => {
    const result = parseFormulaHeader('// AT: appId=appXXX automationId=autXXX\nlet x = 1;', 'automation');
    expect(result).toEqual({ appId: 'appXXX', automationId: 'autXXX' });
  });
});
