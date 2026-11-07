import { describe, it, expect } from 'vitest';
import { parse } from 'jsonc-parser';
import { detectFormatting, getJsoncValue, parseJsonc, pruneEmptyObjects, setJsoncValue } from '../auto-config/jsonc-config.js';

const F = '/cfg/settings.json';
const ENTRY = { command: 'node', args: ['/h/.airtable-user-mcp/start.mjs'], env: { AIRTABLE_HEADLESS_ONLY: '1' } };
const ZED = [
  '// Zed settings',
  '{',
  '  // theme',
  '  "theme": "One Dark",',
  '  "context_servers": {',
  '    // a server the user added',
  '    "other": {',
  '      "command": "x",',
  '    },',
  '  },',
  '  "vim_mode": true,',
  '}',
  '',
].join('\n');

function expectLinesInOrder(out: string, original: string) {
  let at = 0;
  for (const line of original.split('\n').filter(Boolean)) {
    const found = out.indexOf(line, at);
    expect(found, line).toBeGreaterThanOrEqual(0);
    at = found + line.length;
  }
}

describe('setJsoncValue', () => {
  it('adds an entry and keeps every comment, trailing comma, key and key order', () => {
    const out = setJsoncValue(ZED, ['context_servers', 'airtable-user-mcp'], ENTRY, 'jsonc', F);
    expectLinesInOrder(out, ZED);
    expect(getJsoncValue(out, ['context_servers', 'airtable-user-mcp'], 'jsonc', F)).toEqual(ENTRY);
    expect(getJsoncValue(out, ['context_servers', 'other'], 'jsonc', F)).toEqual({ command: 'x' });
  });

  it('removing the entry again restores the file byte for byte', () => {
    const added = setJsoncValue(ZED, ['context_servers', 'airtable-user-mcp'], ENTRY, 'jsonc', F);
    expect(setJsoncValue(added, ['context_servers', 'airtable-user-mcp'], undefined, 'jsonc', F)).toBe(ZED);
  });

  it('replaces an existing entry in place', () => {
    const added = setJsoncValue(ZED, ['context_servers', 'airtable-user-mcp'], ENTRY, 'jsonc', F);
    const out = setJsoncValue(added, ['context_servers', 'airtable-user-mcp'], { command: 'npx' }, 'jsonc', F);
    expect(getJsoncValue(out, ['context_servers', 'airtable-user-mcp'], 'jsonc', F)).toEqual({ command: 'npx' });
    expect(out.indexOf('"other"')).toBeLessThan(out.indexOf('"airtable-user-mcp"'));
    expect(out.indexOf('"airtable-user-mcp"')).toBeLessThan(out.indexOf('"vim_mode"'));
  });

  it('treats a dotted key as one key (Amp "amp.mcpServers")', () => {
    const out = setJsoncValue('{\n  "amp.mcpServers": {}\n}\n', ['amp.mcpServers', 'airtable-user-mcp'], ENTRY, 'json', F);
    expect(parse(out)).toEqual({ 'amp.mcpServers': { 'airtable-user-mcp': ENTRY } });
  });

  it('creates the document and missing parents from an empty file, ending in a newline', () => {
    const out = setJsoncValue('', ['mcpServers', 'airtable-user-mcp'], ENTRY, 'json', F);
    expect(parse(out)).toEqual({ mcpServers: { 'airtable-user-mcp': ENTRY } });
    expect(out.endsWith('\n')).toBe(true);
    expect(out.split('\n')[1].startsWith('  "mcpServers"')).toBe(true);
  });

  it("keeps a comment-only file's comment", () => {
    const out = setJsoncValue('// nothing yet\n', ['mcpServers', 'x'], { a: 1 }, 'json', F);
    expect(out).toContain('// nothing yet');
    expect(parse(out)).toEqual({ mcpServers: { x: { a: 1 } } });
  });

  it('keeps tab indentation', () => {
    const out = setJsoncValue('{\n\t"a": 1\n}\n', ['mcpServers', 'x'], { b: 2 }, 'json', F);
    expect(out).toBe('{\n\t"a": 1,\n\t"mcpServers": {\n\t\t"x": {\n\t\t\t"b": 2\n\t\t}\n\t}\n}\n');
  });

  it('keeps CRLF line endings', () => {
    const out = setJsoncValue('{\r\n  "a": 1\r\n}\r\n', ['mcpServers', 'x'], { b: 2 }, 'json', F);
    expect(out).toBe('{\r\n  "a": 1,\r\n  "mcpServers": {\r\n    "x": {\r\n      "b": 2\r\n    }\r\n  }\r\n}\r\n');
  });

  it('removing from a file without the parent, or from an empty file, returns the text unchanged', () => {
    const text = '{\n  "a": 1\n}\n';
    expect(setJsoncValue(text, ['mcpServers', 'x'], undefined, 'json', F)).toBe(text);
    expect(setJsoncValue('', ['mcpServers', 'x'], undefined, 'json', F)).toBe('');
    expect(setJsoncValue('// c\n', ['mcpServers', 'x'], undefined, 'json', F)).toBe('// c\n');
  });

  it('refuses to write through a parent that is not an object', () => {
    expect(() => setJsoncValue('{ "mcpServers": [] }', ['mcpServers', 'x'], ENTRY, 'json', F))
      .toThrow('/cfg/settings.json: "mcpServers" is not a JSON object. Nothing was written.');
  });
});

describe('parseJsonc', () => {
  it('reads comments in both formats and treats an empty or comment-only file as {}', () => {
    expect(parseJsonc('{ /* c */ "a": 1 }', 'json', F)).toEqual({ a: 1 });
    expect(parseJsonc('', 'json', F)).toEqual({});
    expect(parseJsonc('// c\n', 'jsonc', F)).toEqual({});
  });

  it('accepts a trailing comma only for jsonc', () => {
    expect(parseJsonc('{ "a": 1, }', 'jsonc', F)).toEqual({ a: 1 });
    expect(() => parseJsonc('{ "a": 1, }', 'json', F))
      .toThrow('/cfg/settings.json is not valid JSON (line 1, column 11). Nothing was written.');
  });

  it('refuses a document that is not an object', () => {
    expect(() => parseJsonc('[1]', 'json', F)).toThrow('/cfg/settings.json must contain a JSON object. Nothing was written.');
  });
});

describe('pruneEmptyObjects', () => {
  it('deletes each object on the path that is now empty, innermost first, and stops at a non-empty one', () => {
    const text = '{\n  "mcp": {\n    "servers": {}\n  },\n  "amp.x": 1\n}\n';
    expect(pruneEmptyObjects(text, ['mcp', 'servers'], 'json', F)).toBe('{\n  "amp.x": 1\n}\n');
    const kept = '{\n  "mcp": {\n    "servers": {},\n    "timeout": 5\n  }\n}\n';
    expect(parse(pruneEmptyObjects(kept, ['mcp', 'servers'], 'json', F))).toEqual({ mcp: { timeout: 5 } });
  });
});

describe('detectFormatting', () => {
  it('reads indentation and line endings from the file, defaulting to two spaces and LF', () => {
    expect(detectFormatting('{\n    "a": 1\n}')).toEqual({ insertSpaces: true, tabSize: 4, eol: '\n' });
    expect(detectFormatting('{\r\n\t"a": 1\r\n}')).toEqual({ insertSpaces: false, tabSize: 1, eol: '\r\n' });
    expect(detectFormatting('')).toEqual({ insertSpaces: true, tabSize: 2, eol: '\n' });
  });
});

describe('a leading UTF-8 BOM (Windows editors write one)', () => {
  const BOM = '\uFEFF';

  it('is read past, and a BOM-only file is {}', () => {
    expect(parseJsonc(BOM + '{ "a": 1 }', 'json', F)).toEqual({ a: 1 });
    expect(parseJsonc(BOM, 'json', F)).toEqual({});
    expect(getJsoncValue(BOM + '{ "a": { "b": 2 } }', ['a', 'b'], 'json', F)).toBe(2);
  });

  it('reports positions as an editor shows them, without the BOM', () => {
    expect(() => parseJsonc(BOM + '{ "a": 1, }', 'json', F))
      .toThrow('/cfg/settings.json is not valid JSON (line 1, column 11). Nothing was written.');
  });

  it('is kept on set and on remove, once, and removal restores the file byte for byte', () => {
    const text = BOM + '{\n  "a": 1\n}\n';
    const added = setJsoncValue(text, ['mcpServers', 'x'], { b: 2 }, 'json', F);
    expect(added).toBe(BOM + '{\n  "a": 1,\n  "mcpServers": {\n    "x": {\n      "b": 2\n    }\n  }\n}\n');
    const removed = setJsoncValue(added, ['mcpServers', 'x'], undefined, 'json', F);
    expect(removed.startsWith(BOM) && !removed.slice(1).includes(BOM)).toBe(true);
    expect(parse(removed.slice(1))).toEqual({ a: 1, mcpServers: {} });
    expect(pruneEmptyObjects(removed, ['mcpServers'], 'json', F)).toBe(text);
  });

  it('is not added to a file that had none', () => {
    expect(setJsoncValue('{}', ['a'], 1, 'json', F).startsWith(BOM)).toBe(false);
  });
});
