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
 *
 * Every other line stays byte for byte. A new property goes first in its object: jsonc's formatter
 * re-flows every line an insert touches, and the opening brace's line is the only one that holds
 * nothing of the user's (an insert after the last member re-flowed that member and moved its
 * trailing comment). An object written on one line with members gets a compact insert, unformatted. A removal
 * deletes the member's own lines through the parse tree (removeMember), never through the formatter.
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
  const fmt = detectFormatting(text);
  const tree = jsonc.parseTree(text, [], { allowTrailingComma: format === 'jsonc', disallowComments: false });

  let out: string;
  if (value === undefined) {
    const node = tree && jsonc.findNodeAtLocation(tree, path);
    if (!node) return raw;
    out = removeMember(text, node);
  } else {
    let cur: unknown = doc;
    for (const seg of path.slice(0, -1)) {
      if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) break;
      cur = cur[seg];
      if (!isPlainObject(cur)) {
        throw new Error(`${file}: "${seg}" is not a JSON object. Nothing was written.`);
      }
    }
    const container = tree ? deepestObject(tree, path) : undefined;
    const inserting = !tree || !jsonc.findNodeAtLocation(tree, path);
    if (container && inserting && braceLineEndsInComment(text, container.node)) {
      out = insertBelowBraceLine(text, container.node, path.slice(container.depth), value, fmt);
    } else {
      // A one-line object the user wrote with members in it stays one line; an empty {} opens up.
      const oneLine = container !== undefined && (container.node.children?.length ?? 0) > 0
        && !text.slice(container.node.offset, container.node.offset + container.node.length).includes('\n');
      const edits = jsonc.modify(text, path, value, { formattingOptions: oneLine ? undefined : fmt, getInsertionIndex: () => 0 });
      out = jsonc.applyEdits(text, edits);
    }
  }
  return bom + (out.endsWith('\n') ? out : out + fmt.eol);
}

/** The object the value at `path` is set in (its parent when it exists, else the deepest existing ancestor), and how deep it sits. */
function deepestObject(tree: jsonc.Node, path: readonly string[]): { node: jsonc.Node; depth: number } | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = i === 0 ? tree : jsonc.findNodeAtLocation(tree, path.slice(0, i));
    if (node?.type === 'object') return { node, depth: i };
  }
  return undefined;
}

/** Exactly one block comment that runs to the end of the text: `/* ... */` and nothing after it. */
function isOneBlockComment(rest: string): boolean {
  return rest.startsWith('/*') && rest.endsWith('*/') && rest.length >= 4 && !rest.slice(2, -2).includes('*/');
}

/** `{ // my servers`: the opening brace's line goes on with a comment and nothing else. */
function braceLineEndsInComment(text: string, obj: jsonc.Node): boolean {
  const nl = text.indexOf('\n', obj.offset);
  if (nl < 0) return false;
  const rest = text.slice(obj.offset + 1, nl).trim();
  return rest.startsWith('//') || isOneBlockComment(rest);
}

/**
 * Inserts `segments[0]` (holding `value`, nested under the other segments) first in `obj`, on lines
 * of its own just below the opening brace's line, indented like the first member: the formatter
 * would re-flow the brace line and push its comment after our member, where Remove would take it.
 */
function insertBelowBraceLine(text: string, obj: jsonc.Node, segments: readonly string[], value: unknown, fmt: Formatting): string {
  const nested = segments.slice(1).reduceRight<unknown>((v, seg) => ({ [seg]: v }), value);
  const unit = fmt.insertSpaces ? ' '.repeat(fmt.tabSize) : '\t';
  const indentAt = (pos: number) => /^[ \t]*/.exec(text.slice(lineStartOf(text, pos)))?.[0] ?? '';
  const first = obj.children?.[0];
  const indent = first ? indentAt(first.offset) : indentAt(obj.offset) + unit;
  const body = JSON.stringify(nested, null, unit).split('\n').join(fmt.eol + indent);
  const member = `${indent}${JSON.stringify(segments[0])}: ${body}${first ? ',' : ''}${fmt.eol}`;
  const at = lineEndOf(text, obj.offset);
  return text.slice(0, at) + member + text.slice(at);
}

const cut = (text: string, from: number, to: number): string => text.slice(0, from) + text.slice(to);

const lineStartOf = (text: string, pos: number): number => text.lastIndexOf('\n', pos - 1) + 1;

/** Just past the newline that ends `pos`'s line (or the end of the text). */
function lineEndOf(text: string, pos: number): number {
  const nl = text.indexOf('\n', pos);
  return nl < 0 ? text.length : nl + 1;
}

/** From `pos` to the end of its line: nothing but whitespace, or one comment. */
function restOfLineIsTrailing(text: string, pos: number): boolean {
  const nl = text.indexOf('\n', pos);
  const rest = text.slice(pos, nl < 0 ? text.length : nl).trim();
  return rest === '' || rest.startsWith('//') || isOneBlockComment(rest);
}

function skipBlanks(text: string, pos: number): number {
  let i = pos;
  while (text[i] === ' ' || text[i] === '\t') i++;
  return i;
}

/** The offset of the comma that follows `pos` (past whitespace and comments), or -1. */
function commaAfter(text: string, pos: number): number {
  const scanner = jsonc.createScanner(text, true);
  scanner.setPosition(pos);
  let token = scanner.scan();
  while (token === jsonc.SyntaxKind.LineCommentTrivia || token === jsonc.SyntaxKind.BlockCommentTrivia) token = scanner.scan();
  return token === jsonc.SyntaxKind.CommaToken ? scanner.getTokenOffset() : -1;
}

/**
 * Removes the member whose value is `valueNode`. A member on lines of its own loses exactly those
 * lines (with its comma, or the comma before it when it was last); one sharing a line loses its
 * text and one comma. An object it was the only member of, with nothing but whitespace left
 * inside, becomes `{}`.
 */
function removeMember(text: string, valueNode: jsonc.Node): string {
  const prop = valueNode.parent as jsonc.Node;
  const obj = prop.parent as jsonc.Node;
  const siblings = obj.children ?? [];
  const index = siblings.indexOf(prop);
  const start = prop.offset;
  const end = prop.offset + prop.length;
  const ownLine = text.slice(lineStartOf(text, start), start).trim() === '';
  const comma = commaAfter(text, end);
  let out: string;
  if (comma >= 0) {
    out = ownLine && restOfLineIsTrailing(text, comma + 1)
      ? cut(text, lineStartOf(text, start), lineEndOf(text, comma + 1))
      : cut(text, start, skipBlanks(text, comma + 1));
  } else if (index > 0) {
    const previous = siblings[index - 1];
    const before = commaAfter(text, previous.offset + previous.length);
    out = ownLine && restOfLineIsTrailing(text, end)
      ? cut(cut(text, lineStartOf(text, start), lineEndOf(text, end)), before, before + 1)
      : cut(text, before, end);
  } else {
    out = ownLine && restOfLineIsTrailing(text, end) ? cut(text, lineStartOf(text, start), lineEndOf(text, end)) : cut(text, start, end);
  }
  if (siblings.length === 1) {
    const close = obj.offset + obj.length - 1 - (text.length - out.length);
    if (out.slice(obj.offset + 1, close).trim() === '') out = out.slice(0, obj.offset + 1) + out.slice(close);
  }
  return out;
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
