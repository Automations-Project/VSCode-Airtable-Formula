import * as fs from 'fs';
import * as jsonc from 'jsonc-parser';

/** `json` rejects trailing commas; `jsonc` (Zed, VS Code settings) accepts them. Comments are accepted in both. */
export type JsonFormat = 'json' | 'jsonc';

export interface Formatting {
  insertSpaces: boolean;
  tabSize: number;
  eol: '\n' | '\r\n';
}

/** File contents, or null when the file does not exist. Anything else (EACCES, EISDIR...) is rethrown. */
export async function readTextIfExists(file: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Indentation and line endings used by the file, defaulting to two spaces and LF. */
export function detectFormatting(text: string): Formatting {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^([ \t]+)\S/m.exec(text)?.[1];
  if (indent === undefined) return { insertSpaces: true, tabSize: 2, eol };
  if (indent[0] === '\t') return { insertSpaces: false, tabSize: 1, eol };
  return { insertSpaces: true, tabSize: Math.min(8, Math.max(1, indent.length)), eol };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - (before.lastIndexOf('\n') + 1) + 1 };
}

/**
 * A leading UTF-8 byte order mark, which Windows editors write and jsonc-parser rejects. Every
 * function here reads past it, and setJsoncValue puts it back, so an edited file keeps it.
 * The TOML writer in lsp-config.ts strips and restores it the same way.
 */
const BOM = '\uFEFF';

export function splitBom(text: string): { bom: string; body: string } {
  return text.startsWith(BOM) ? { bom: BOM, body: text.slice(BOM.length) } : { bom: '', body: text };
}

/** Parses an object document. An empty or comment-only file is `{}`. Throws on anything malformed. */
export function parseJsonc(raw: string, format: JsonFormat, file: string): Record<string, unknown> {
  const text = splitBom(raw).body;
  const errors: jsonc.ParseError[] = [];
  const value: unknown = jsonc.parse(text, errors, {
    allowTrailingComma: format === 'jsonc',
    disallowComments: false,
  });
  if (
    value === undefined &&
    jsonc.stripComments(text).trim() === '' &&
    errors.every((e) => e.error === jsonc.ParseErrorCode.ValueExpected)
  ) {
    return {};
  }
  if (errors.length > 0) {
    const { line, column } = lineAndColumn(text, errors[0].offset);
    throw new Error(`${file} is not valid JSON (line ${line}, column ${column}). Nothing was written.`);
  }
  if (!isPlainObject(value)) {
    throw new Error(`${file} must contain a JSON object. Nothing was written.`);
  }
  return value;
}

/** The value at `jsonPath`, walking plain objects only; `undefined` if absent or blocked by a non-object. */
export function getJsoncValue(text: string, jsonPath: readonly string[], format: JsonFormat, file: string): unknown {
  let cur: unknown = parseJsonc(text, format, file);
  for (const seg of jsonPath) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Sets (or, for `value === undefined`, removes) the value at `jsonPath`, editing the text in place so
 * comments, trailing commas, key order and indentation survive. Returns the new text. A file that does
 * not parse is never edited.
 */
export function setJsoncValue(
  raw: string,
  jsonPath: readonly string[],
  value: unknown,
  format: JsonFormat,
  file: string,
): string {
  const { bom, body: text } = splitBom(raw);
  const doc = parseJsonc(text, format, file);
  const path = [...jsonPath];

  if (value === undefined) {
    const tree = jsonc.parseTree(text);
    if (!tree || !jsonc.findNodeAtLocation(tree, path)) return raw;
  } else {
    let cur: unknown = doc;
    for (const seg of path.slice(0, -1)) {
      if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) break;
      cur = cur[seg];
      if (!isPlainObject(cur)) {
        throw new Error(`${file}: "${seg}" is not a JSON object. Nothing was written.`);
      }
    }
  }

  const fmt = detectFormatting(text);
  // Formatting options are needed for removals too: without them a removed first member leaves the
  // next one on the opening brace's line.
  const edits = jsonc.modify(text, path, value, { formattingOptions: fmt });
  const out = jsonc.applyEdits(text, edits);
  return bom + (out.endsWith('\n') ? out : out + fmt.eol);
}

/** Removes each object along `jsonPath` that is now empty, innermost first, stopping at the first non-empty one. */
export function pruneEmptyObjects(text: string, jsonPath: readonly string[], format: JsonFormat, file: string): string {
  let out = text;
  for (let i = jsonPath.length; i >= 1; i--) {
    const sub = jsonPath.slice(0, i);
    const v = getJsoncValue(out, sub, format, file);
    if (!isPlainObject(v) || Object.keys(v).length > 0) break;
    out = setJsoncValue(out, sub, undefined, format, file);
  }
  return out;
}
