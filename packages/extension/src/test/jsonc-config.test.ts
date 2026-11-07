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
    expect(out.indexOf('"airtable-user-mcp"')).toBe(added.indexOf('"airtable-user-mcp"'));
    expectLinesInOrder(out, ZED);
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
    expect(out).toBe('{\n\t"mcpServers": {\n\t\t"x": {\n\t\t\t"b": 2\n\t\t}\n\t},\n\t"a": 1\n}\n');
  });

  it('keeps CRLF line endings', () => {
    const out = setJsoncValue('{\r\n  "a": 1\r\n}\r\n', ['mcpServers', 'x'], { b: 2 }, 'json', F);
    expect(out).toBe('{\r\n  "mcpServers": {\r\n    "x": {\r\n      "b": 2\r\n    }\r\n  },\r\n  "a": 1\r\n}\r\n');
    expect(setJsoncValue(out, ['mcpServers'], undefined, 'json', F)).toBe('{\r\n  "a": 1\r\n}\r\n');
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

// Our member is added first in its object and removed by deleting its own lines, so the user's
// lines (a compact server with a trailing comment, Zed's trailing commas) stay byte for byte.
describe("the user's neighbouring lines are never re-flowed", () => {
  const OURS = ['mcpServers', 'airtable-user-mcp'];
  const VALUE = { command: 'npx', args: ['-y', 'airtable-user-mcp'] };
  const roundTrip = (text: string, format: 'json' | 'jsonc' = 'json', path = OURS) => {
    const added = setJsoncValue(text, path, VALUE, format, F);
    for (const line of text.split('\n')) expect(added.split('\n'), line).toContain(line);
    expect(getJsoncValue(added, path, format, F)).toEqual(VALUE);
    expect(setJsoncValue(added, path, undefined, format, F)).toBe(text);
  };

  it.each([
    ['a trailing // comment', '{\n  "mcpServers": {\n    "github": { "command": "gh" } // my github server\n  }\n}\n'],
    ['a trailing /* */ comment', '{\n  "mcpServers": {\n    "github": { "command": "gh" } /* my github server */\n  },\n  "x": 1\n}\n'],
    ['comments after commas', '{\n  "mcpServers": {\n    "a": { "command": "a" }, // A\n    "b": { "command": "b" } // B\n  }\n}\n'],
    ['an empty object holding a comment', '{\n  "mcpServers": {\n    // add servers here\n  }\n}\n'],
    ['a commented-out server', '{\n  "mcpServers": {\n    "a": { "command": "a" }\n    // "old": { "command": "old" }\n  }\n}\n'],
  ])('a compact last sibling with %s: set keeps every line, remove restores the file', (_name, text) => roundTrip(text));

  it("Zed's trailing commas", () => roundTrip(ZED, 'jsonc', ['context_servers', 'airtable-user-mcp']));

  // A comment after the opening brace belongs to that line: our member goes on lines of its own
  // below it, so Remove takes exactly those lines and the comment never moves.
  it.each([
    ["the container's brace line", '{\n  "mcpServers": { // my servers\n    "a": { "command": "a" }\n  }\n}\n', OURS],
    ['an empty container', '{\n  "mcpServers": { /* none yet */\n  }\n}\n', OURS],
    ['the root brace line', '{ // my settings\n  "theme": "x"\n}\n', ['airtable-user-mcp']],
  ])('a comment on %s stays put through add and remove, LF and CRLF', (_name, lf, path) => {
    for (const text of [lf, lf.replace(/\n/g, '\r\n')]) {
      const added = setJsoncValue(text, path, VALUE, 'jsonc', F);
      const braceLine = text.split('\n').find(l => l.includes('/'));
      expect(added.split('\n')).toContain(braceLine);
      expect(getJsoncValue(added, path, 'jsonc', F)).toEqual(VALUE);
      if (text.includes('\r')) expect(/[^\r]\n/.test(added)).toBe(false);
      expect(setJsoncValue(added, path, undefined, 'jsonc', F)).toBe(text);
    }
  });

  it('an empty object opens for our entry and is {} again after Remove', () => {
    const text = '{\n  "mcpServers": {},\n  "x": 1\n}\n';
    const added = setJsoncValue(text, OURS, VALUE, 'json', F);
    expect(added.endsWith('  },\n  "x": 1\n}\n')).toBe(true);
    expect(setJsoncValue(added, OURS, undefined, 'json', F)).toBe(text);
  });

  it('a file on one line gets a compact insert and comes back exactly', () => {
    const text = '{"mcpServers":{"a":{"command":"a"}},"theme":"dark"}\n';
    const added = setJsoncValue(text, OURS, VALUE, 'json', F);
    expect(added).toBe('{"mcpServers":{"airtable-user-mcp": {"command":"npx","args":["-y","airtable-user-mcp"]},"a":{"command":"a"}},"theme":"dark"}\n');
    expect(setJsoncValue(added, OURS, undefined, 'json', F)).toBe(text);
  });

  it('our entry written last (as main wrote it) goes with its lines and the comma before it; the comment stays put', () => {
    const before = '{\n  "mcpServers": {\n    "github": { "command": "gh" }, // my github server\n    "airtable-user-mcp": {\n      "command": "npx"\n    }\n  }\n}\n';
    expect(setJsoncValue(before, OURS, undefined, 'json', F))
      .toBe('{\n  "mcpServers": {\n    "github": { "command": "gh" } // my github server\n  }\n}\n');
  });

  it('our entry written first goes with its own lines; the compact sibling after it is untouched', () => {
    const text = '{\n  "mcpServers": {\n    "airtable-user-mcp": { "command": "npx" },\n    "github": { "command": "gh" } /* mine */\n  }\n}\n';
    expect(setJsoncValue(text, OURS, undefined, 'json', F))
      .toBe('{\n  "mcpServers": {\n    "github": { "command": "gh" } /* mine */\n  }\n}\n');
  });

  it('a member sharing a line loses its own text and one comma only', () => {
    expect(setJsoncValue('{ "a": 1, "airtable-user-mcp": 2, "b": 3 }\n', ['airtable-user-mcp'], undefined, 'json', F)).toBe('{ "a": 1, "b": 3 }\n');
    expect(setJsoncValue('{ "a": 1, "airtable-user-mcp": 2 }\n', ['airtable-user-mcp'], undefined, 'json', F)).toBe('{ "a": 1 }\n');
    expect(setJsoncValue('{\n  "a": 1,\n  "airtable-user-mcp": 2,\n}\n', ['airtable-user-mcp'], undefined, 'jsonc', F)).toBe('{\n  "a": 1,\n}\n');
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
    expect(added).toBe(BOM + '{\n  "mcpServers": {\n    "x": {\n      "b": 2\n    }\n  },\n  "a": 1\n}\n');
    const removed = setJsoncValue(added, ['mcpServers', 'x'], undefined, 'json', F);
    expect(removed.startsWith(BOM) && !removed.slice(1).includes(BOM)).toBe(true);
    expect(parse(removed.slice(1))).toEqual({ a: 1, mcpServers: {} });
    expect(pruneEmptyObjects(removed, ['mcpServers'], 'json', F)).toBe(text);
  });

  it('is not added to a file that had none', () => {
    expect(setJsoncValue('{}', ['a'], 1, 'json', F).startsWith(BOM)).toBe(false);
  });
});
