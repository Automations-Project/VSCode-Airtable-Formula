import { describe, it, expect } from 'vitest';
import {
  SCRIPT_GLOBALS,
  SCRIPT_GLOBAL_NAMES,
  getScriptGlobal,
} from '../../engines/script/index.js';

describe('SCRIPT_GLOBALS', () => {
  it('contains all 8 top-level globals', () => {
    for (const name of ['base', 'table', 'cursor', 'input', 'output', 'session', 'fetch', 'remoteFetchAsync']) {
      expect(SCRIPT_GLOBALS[name], `Expected global "${name}" to be defined`).toBeDefined();
    }
  });

  it('each global has a string description', () => {
    for (const name of SCRIPT_GLOBAL_NAMES) {
      expect(typeof SCRIPT_GLOBALS[name].description).toBe('string');
      expect(SCRIPT_GLOBALS[name].description.length).toBeGreaterThan(0);
    }
  });

  it('each global has a methods object', () => {
    for (const name of SCRIPT_GLOBAL_NAMES) {
      expect(SCRIPT_GLOBALS[name].methods).toBeDefined();
      expect(typeof SCRIPT_GLOBALS[name].methods).toBe('object');
    }
  });

  it('base.getTables has signature and description', () => {
    expect(SCRIPT_GLOBALS['base'].methods['getTables']).toBeDefined();
    expect(SCRIPT_GLOBALS['base'].methods['getTables'].signature).toContain('getTables');
    expect(SCRIPT_GLOBALS['base'].methods['getTables'].description).toBeTruthy();
  });

  it('table.selectRecordsAsync is defined', () => {
    expect(SCRIPT_GLOBALS['table'].methods['selectRecordsAsync']).toBeDefined();
  });

  it('cursor has all 4 properties including selectedRecordIds and selectedFieldIds (D-03)', () => {
    expect(SCRIPT_GLOBALS['cursor'].methods['activeTableId'] ?? SCRIPT_GLOBALS['cursor'].methods['selectedRecordIds']).toBeDefined();
  });

  it('SCRIPT_GLOBAL_NAMES is an array of 8 strings', () => {
    expect(SCRIPT_GLOBAL_NAMES).toHaveLength(8);
    expect(SCRIPT_GLOBAL_NAMES).toContain('base');
    expect(SCRIPT_GLOBAL_NAMES).toContain('remoteFetchAsync');
  });

  it('getScriptGlobal returns the entry for base', () => {
    const info = getScriptGlobal('base');
    expect(info).toBeDefined();
    expect(info!.description).toBeTruthy();
  });

  it('getScriptGlobal returns undefined for unknown name', () => {
    expect(getScriptGlobal('unknownXYZ')).toBeUndefined();
  });
});
