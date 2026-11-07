// Pure offline lint: runs the vendored language-services engines over code text.
// No I/O, no auth, no client.
import { stripHeader } from './formula-header.js';
import { formulaDiagnostics, scriptDiagnostics, automationDiagnostics } from './vendor/language-services.mjs';

export const LINT_LANGUAGES = ['formula', 'script', 'automation'];
export const MAX_TEXT_LENGTH = 200_000;
export const MAX_DIAGNOSTICS = 100;

const ENGINES = {
  formula: formulaDiagnostics,
  script: scriptDiagnostics,
  automation: automationDiagnostics,
};

// LsSeverity: Error 0, Warning 1, Information 2, Hint 3
const SEVERITY = ['error', 'warning', 'info', 'hint'];

export function lintAirtableCode({ language, text }) {
  if (!LINT_LANGUAGES.includes(language)) {
    throw new Error(`language must be one of ${LINT_LANGUAGES.join(', ')}`);
  }
  if (typeof text !== 'string') throw new Error('text must be a string');
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`text is too long: ${text.length} characters, limit ${MAX_TEXT_LENGTH}`);
  }

  const { text: body, offset } = stripHeader(text, language);
  const all = analyse(language, body).map((d) => {
    const out = {
      severity: SEVERITY[d.severity] ?? 'info',
      line: d.range.start.line + 1 + offset,
      column: d.range.start.character + 1,
      endLine: d.range.end.line + 1 + offset,
      endColumn: d.range.end.character + 1,
      message: d.message,
    };
    if (d.code !== undefined && d.code !== null) out.code = d.code;
    return out;
  });
  all.sort((a, b) => a.line - b.line || a.column - b.column);

  const errorCount = all.filter((d) => d.severity === 'error').length;
  const warningCount = all.filter((d) => d.severity === 'warning').length;
  const result = {
    language,
    clean: errorCount === 0 && warningCount === 0,
    errorCount,
    warningCount,
    diagnostics: all.slice(0, MAX_DIAGNOSTICS),
  };
  if (all.length > MAX_DIAGNOSTICS) result.truncated = all.length;
  return result;
}

function analyse(language, body) {
  try {
    return ENGINES[language](body);
  } catch (e) {
    // Defensive net only. The engines build their results with loops and none
    // recurses per nesting level, so no input under the cap reaches this today
    // (the RangeError that 150k '(' used to raise came from a push(...spread) of
    // its diagnostics, since fixed). It can still fire if an engine ever recurses
    // per level of nesting and overflows the stack for real. Say what is wrong
    // instead of leaking V8's message.
    if (e instanceof RangeError && e.message.includes('call stack')) {
      throw new Error('input is too large or too deeply nested to analyse');
    }
    throw e;
  }
}
